import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '@tallyfin/storage-d1';
import { emptyOverviewRow, DAY, localDate } from '@tallyfin/core';
import { parseOverview } from '../../admin/src/api/overview-contract.ts';
import { now, registry, seed, setup } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'overview-reader' };
const ids = ['sembom', 'service-b', 'service-c', 'service-d', 'service-e'];
const day = localDate(now, registry.project.timeZone), shift = (days: number) => new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);
const period = { timeZone: registry.project.timeZone, from: shift(-6), to: day, previousFrom: shift(-13), previousTo: shift(-7) };
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_minute_usage', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  for (const id of ids) {
    await seed(fixture.db, id, { events: registry.events, workflows: registry.workflows, representativeWorkflowId: registry.workflows[0]!.id });
    await fixture.db.prepare('INSERT INTO project_grants(project_id,issuer,subject,role,created_at) VALUES(?,?,?,?,?)')
      .bind(id, principal.issuer, principal.subject, 'reader', now).run();
  }
});
const request = (query = 'projectIds=sembom', method = 'GET', auth = true) => new Request(`https://collector.example.invalid/v1/overview?${query}`,
  { method, headers: auth ? { Authorization: 'Bearer fixture' } : {} });
function handler(db: SqlDatabase = fixture.db) {
  return createCollector(fixture.store, { now: () => now, admin: { store: new D1Queries(db), verifyBearer: async () => principal } });
}
function measured(beforeBatch?: (index: number) => Promise<void>, alter?: (index: number, result: any[]) => void) {
  let batches = 0, statements = 0;
  const db: SqlDatabase = { prepare: sql => fixture.db.prepare(sql), batch: async <T>(input: SqlStatement[]) => {
    const index = ++batches; statements += input.length;
    await beforeBatch?.(index);
    const result = await fixture.db.batch<T>(input as any); alter?.(index, result); return result;
  } };
  return { db, totals: () => ({ batches, statements }) };
}

test('explicit second workflow wins independently of registration order; unset versions never fall back', async () => {
  const first = registry.workflows[0]!, second = { ...first, id: 'chosen', label: 'Chosen workflow',
    startEvent: 'chosen_start', successEvent: 'chosen_success', failureEvent: null };
  const events = [...registry.events, ...[second.startEvent, second.successEvent].map(name =>
    ({ ...registry.events.find(event => event.name === first.startEvent)!, name }))];
  const store = new D1Queries(fixture.db);
  for (const version of [2, 3, 4]) {
    const definitions = { events, workflows: version === 3 ? [second, first] : [first, second],
      ...(version === 4 ? {} : { representativeWorkflowId: second.id }) };
    await fixture.db.prepare('INSERT INTO project_schemas(project_id,version,status,definitions_json,published_at) VALUES(?,?,?,?,?)')
      .bind('sembom', version, 'active', JSON.stringify(definitions), now).run();
    for (const [id, starts, successes] of [[first.id, 4, 4], [second.id, 8, 2]] as const)
      await fixture.db.prepare('INSERT INTO workflow_daily_counts (project_id,schema_version,source,cohort_date,workflow_id,dimension_key,started_count,succeeded_count,failed_count,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .bind('sembom', version, 'browser', day, id, '{}', starts, successes, 0, now).run();
    const row = parseOverview(await (await handler()(request())).json()).data[0]!;
    assert.equal(row.version, version); assert.equal(row.error, false);
    assert.equal(row.completion, version === 4 ? null : 25);
    assert.equal(row.workflowLabel, version === 4 ? null : second.label);
    if (version === 4) assert.equal(row.workflowStats, null);
    else assert.equal(row.workflowStats!.current.startedAttempts, 8);
    assert.equal((await store.overview(principal, ['sembom'], 'server', now)).data[0]!.completion, null);
  }
  // A corrupt stored reference is rejected, rather than displaying another workflow's metric.
  await fixture.db.prepare('INSERT INTO project_schemas(project_id,version,status,definitions_json,published_at) VALUES(?,?,?,?,?)')
    .bind('sembom', 5, 'active', JSON.stringify({ events, workflows: [first, second], representativeWorkflowId: 'foreign' }), now).run();
  const invalid = (await store.overview(principal, ['sembom'], 'browser', now)).data[0]!;
  assert.equal(invalid.error, true); assert.equal(invalid.completion, null);
});
test('five services use one HTTP read and bounded sequential rejection scans in requested order', async () => {
  const m = measured(), response = await handler(m.db)(request(`projectIds=${[...ids].reverse().join(',')}`));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  const body = parseOverview(await response.json());
  assert.deepEqual(body.data.map(r => r.projectId), [...ids].reverse());
  assert.ok(body.data.every(r => r.events === 0 && r.rejected === 0 && !r.error));
  assert.deepEqual(m.totals(), { batches: 7, statements: 22 });
});
test('period totals and workflow rates match existing reads across local midnight and source boundaries', async () => {
  const date = localDate(now, registry.project.timeZone), prior = new Date(Date.parse(date) - 7 * DAY).toISOString().slice(0, 10);
  for (const [day, count] of [[date, 9], [prior, 4]] as const) {
    await fixture.db.prepare('INSERT INTO event_daily_counts(project_id,schema_version,source,event_date,event_name,dimension_key,count,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind('sembom', 1, 'browser', day, registry.events[0]!.name, '{}', count, now).run();
    await fixture.db.prepare('INSERT INTO workflow_daily_counts (project_id,schema_version,source,cohort_date,workflow_id,dimension_key,started_count,succeeded_count,failed_count,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind('sembom', 1, 'browser', day, registry.workflows[0]!.id, '{}', 4, count === 9 ? 3 : 1, 0, now).run();
  }
  const store = new D1Queries(fixture.db), body = await store.overview(principal, ['sembom'], 'browser', now), row = body.data[0]!;
  assert.equal(row.events, 9); assert.equal(row.previousEvents, 4); assert.equal(row.completion, 75); assert.equal(row.previousCompletion, 25);
  assert.deepEqual(row.workflowStats, {
    current: { startedAttempts: 4, succeededAttempts: 3, failedAttempts: null, pendingAttempts: 1, provisional: true },
    previous: { startedAttempts: 4, succeededAttempts: 1, failedAttempts: null, pendingAttempts: 3, provisional: false },
  });
  const from = new Date(Date.parse(date) - 6 * DAY).toISOString().slice(0, 10);
  const summary: any = await store.query(principal, { projectId: 'sembom', version: 1, kind: 'summary', from, to: date }, now);
  const workflow: any = await store.query(principal, { projectId: 'sembom', version: 1, kind: 'workflow', name: registry.workflows[0]!.id, from, to: date }, now);
  assert.equal(row.events, summary.totalEvents); assert.equal(row.completion, workflow.summary.completionRate);
  const minute = Math.floor(now / 60000) * 60000, utcTo = new Date(now).toISOString().slice(0, 10);
  await fixture.db.prepare('INSERT INTO ingest_minute_usage(project_id,minute_start,request_count,rejections_json) VALUES(?,?,?,?)')
    .bind('sembom', minute, 1, JSON.stringify({ invalid_event: { count: 3, lastRejectedAt: now } })).run();
  const rejection = await store.rejections(principal, 'sembom', new Date(Date.parse(utcTo) - 6 * DAY).toISOString().slice(0, 10), utcTo, now);
  const server = await store.overview(principal, ['sembom'], 'server', now);
  assert.equal(server.data[0]!.events, 0); assert.equal(server.data[0]!.workflowLabel, null);
  assert.equal(server.data[0]!.workflowStats, null);
  assert.equal(server.data[0]!.rejected, rejection.summary.rejectedRequests); assert.equal(server.data[0]!.rejected, 3);
});
test('missing and foreign projects are identical denials; empty active schemas remain distinct', async () => {
  await fixture.db.prepare("DELETE FROM project_grants WHERE project_id='service-b'").run();
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE project_id='service-c'").run();
  const body = parseOverview(await (await handler()(request('projectIds=sembom,service-b,missing,service-c'))).json());
  assert.equal(body.data[0]!.error, false);
  for (const row of body.data.slice(1, 3)) assert.deepEqual(row, { ...emptyOverviewRow(row.projectId), error: true, accessDenied: true });
  assert.deepEqual(body.data[3], { ...emptyOverviewRow('service-c'), period, rejected: 0 });
});
test('revocation and schema changes between batches cannot expose stale metrics', async () => {
  for (const sql of ["DELETE FROM project_grants WHERE project_id='sembom'",
    "UPDATE project_schemas SET status='retired' WHERE project_id='sembom'"]) {
    const m = measured(async index => { if (index === 2) await fixture.db.prepare(sql).run(); });
    const body = parseOverview(await (await handler(m.db)(request('projectIds=sembom,service-b'))).json());
    assert.equal(body.data[0]!.error, true); assert.equal(body.data[0]!.events, null); assert.equal(body.data[1]!.error, false);
    await fixture.db.prepare("UPDATE project_schemas SET status='active' WHERE project_id='sembom'").run();
    await fixture.db.prepare('INSERT OR IGNORE INTO project_grants(project_id,issuer,subject,role,created_at) VALUES(?,?,?,?,?)')
      .bind('sembom', principal.issuer, principal.subject, 'reader', now).run();
  }
});
test('corrupt workflow/rejection data preserve event totals and other rows; shared storage failure is 503', async () => {
  const m = measured(undefined, (index, result) => {
    if (index === 2) result[2].results = [{ cohort_date: localDate(now, registry.project.timeZone), started_count: 1, succeeded_count: 2, failed_count: 0 }];
    if (index === 3) result[1].results = [{ minute_start: Math.floor(now / 60000) * 60000, rejections_json: 'broken' }];
  });
  const body = parseOverview(await (await handler(m.db)(request('projectIds=sembom,service-b'))).json());
  assert.equal(body.data[0]!.events, 0); assert.equal(body.data[0]!.workflowUnavailable, true); assert.equal(body.data[0]!.rejectionUnavailable, true);
  assert.equal(body.data[1]!.error, false);
  const failed = measured(async () => { throw Error('private database detail'); });
  const response = await handler(failed.db)(request()); assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private database detail'));
});
test('real D1 rejection pages sum exactly once across the page boundary', async () => {
  const to = new Date(now).toISOString().slice(0, 10), from = new Date(Date.parse(to) - 6 * DAY).toISOString().slice(0, 10), start = Date.parse(from);
  await fixture.db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n < 4096)
    INSERT INTO ingest_minute_usage(project_id,minute_start,request_count,rejections_json)
    SELECT 'sembom', ? + n*60000, 1, json_object('invalid_event', json_object('count',1,'lastRejectedAt',? + n*60000)) FROM seq`)
    .bind(start, start).run();
  const m = measured(), store = new D1Queries(m.db);
  const result = await store.overview(principal, ['sembom'], 'browser', now);
  assert.equal(result.data[0]!.rejected, 4097); assert.equal(result.data[0]!.rejectionUnavailable, false);
  assert.deepEqual(m.totals(), { batches: 4, statements: 8 });
  assert.equal(result.data[0]!.rejected, (await new D1Queries(fixture.db).rejections(principal, 'sembom', from, to, now)).summary.rejectedRequests);
});
test('five full rejection ranges stay within 42 SQL statements and only one raw page at a time', async () => {
  let maxRows = 0;
  const start = Date.parse(new Date(now - 6 * DAY).toISOString().slice(0, 10));
  const m = measured(undefined, (index, result) => {
    if (index < 3) return;
    const offset = (index - 3) % 3 * 4096;
    const rows = Array.from({ length: Math.min(4096, 10080 - offset) }, (_, i) => {
      const minute = start + (offset + i) * 60000;
      return { minute_start: minute, rejections_json: JSON.stringify({ invalid_event: { count: 1, lastRejectedAt: minute } }) };
    });
    result[1].results = rows; maxRows = Math.max(maxRows, rows.length);
  });
  const result = await new D1Queries(m.db).overview(principal, ids, 'browser', now);
  assert.ok(result.data.every(row => row.rejected === 10080 && !row.rejectionUnavailable));
  assert.equal(maxRows, 4096); assert.deepEqual(m.totals(), { batches: 17, statements: 42 });
});
test('permission loss during rejection scan clears all previously loaded service metrics', async () => {
  const m = measured(async index => { if (index === 3) await fixture.db.prepare("DELETE FROM project_grants WHERE project_id='sembom'").run(); });
  const result = parseOverview(await (await handler(m.db)(request('projectIds=sembom,service-b'))).json());
  assert.deepEqual(result.data[0], { ...emptyOverviewRow('sembom'), error: true, accessDenied: true });
  assert.equal(result.data[1]!.events, 0);
});
test('authentication precedes input validation; invalid input performs no DB reads', async () => {
  const m = measured(), run = handler(m.db);
  assert.equal((await run(request('projectIds=!', 'GET', false))).status, 401);
  for (const query of ['', 'projectIds=', 'projectIds=sembom,sembom', `projectIds=${ids.join(',')},sixth`, 'projectIds=!',
    'projectIds=sembom&source=bad', 'projectIds=sembom&source=browser&source=server', 'projectIds=sembom&extra=1'])
    assert.equal((await run(request(query))).status, 400, query);
  const method = await run(request(undefined, 'POST')); assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'GET');
  assert.deepEqual(m.totals(), { batches: 0, statements: 0 });
});
test('cancellation after metadata preserves its reason and prevents aggregate reads', async () => {
  const controller = new AbortController(), reason = { cancelled: true };
  const m = measured(undefined, index => { if (index === 1) controller.abort(reason); });
  await assert.rejects(new D1Queries(m.db).overview(principal, ids, 'browser', now, { signal: controller.signal }), error => error === reason);
  assert.deepEqual(m.totals(), { batches: 1, statements: 1 });
});
test('retired newest versions use the earlier active version; all-retired projects still read project diagnostics', async () => {
  await fixture.db.prepare("INSERT INTO project_schemas(project_id,version,status,definitions_json,published_at) SELECT project_id,2,'retired',definitions_json,published_at FROM project_schemas WHERE project_id='sembom'").run();
  assert.equal((await new D1Queries(fixture.db).overview(principal, ['sembom'], 'browser', now)).data[0]!.version, 1);
  await fixture.db.prepare("UPDATE project_schemas SET status='retired'").run();
  const m = measured(), response = await new D1Queries(m.db).overview(principal, ids, 'browser', now);
  assert.ok(response.data.every(row => row.version === null && !row.error));
  assert.deepEqual(m.totals(), { batches: 6, statements: 11 });
});
test('invalid aggregate counts fail only the affected service', async () => {
  const m = measured(undefined, (index, result) => {
    if (index === 2) result[1].results = [{ event_name: registry.events[0]!.name, period: 1, count: Number.MAX_SAFE_INTEGER + 1 }];
  });
  const body = parseOverview(await (await handler(m.db)(request('projectIds=sembom,service-b'))).json());
  assert.equal(body.data[0]!.error, true); assert.equal(body.data[0]!.accessDenied, false); assert.equal(body.data[0]!.events, null);
  assert.equal(body.data[1]!.events, 0);
});
test('retired and never-published schemas preserve independent receipt and rejection diagnostics', async () => {
  const minute = Math.floor(now / 60000) * 60000;
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE project_id='sembom'").run();
  await fixture.db.prepare("DELETE FROM project_schemas WHERE project_id='service-b'").run();
  for (const id of ['sembom', 'service-b']) {
    await fixture.db.prepare('UPDATE projects SET latest_received_at=? WHERE id=?').bind(now, id).run();
    await fixture.db.prepare('INSERT INTO ingest_minute_usage(project_id,minute_start,request_count,rejections_json) VALUES(?,?,?,?)')
      .bind(id, minute, 1, JSON.stringify({ unknown_schema: { count: 3, lastRejectedAt: now } })).run();
  }
  for (const source of ['browser', 'server'] as const) {
    const m = measured(), response = await new D1Queries(m.db).overview(principal, ['sembom', 'service-b'], source, now);
    const body = parseOverview(response);
    for (const row of body.data) assert.deepEqual(row, { ...emptyOverviewRow(row.projectId), period, rejected: 3, latestReceivedAt: new Date(now).toISOString() });
    assert.deepEqual(m.totals(), { batches: 3, statements: 5 });
  }
  await fixture.db.prepare("DELETE FROM project_grants WHERE project_id='sembom'").run();
  const body = await new D1Queries(fixture.db).overview(principal, ['sembom'], 'browser', now);
  assert.deepEqual(body.data[0], { ...emptyOverviewRow('sembom'), error: true, accessDenied: true });
});
test('schema-free rejection failure preserves receipt time and never invents a zero total', async () => {
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE project_id='sembom'").run();
  await fixture.db.prepare("UPDATE projects SET latest_received_at=? WHERE id='sembom'").bind(now).run();
  const m = measured(async index => { if (index === 2) throw Error('private storage failure'); });
  const response = await handler(m.db)(request()); assert.equal(response.status, 200);
  const body = parseOverview(await response.json());
  assert.deepEqual(body.data[0], { ...emptyOverviewRow('sembom'), period, latestReceivedAt: new Date(now).toISOString(), rejectionUnavailable: true });
});
test('schema-free diagnostics recheck grants before disclosing receipt history', async () => {
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE project_id='sembom'").run();
  await fixture.db.prepare("UPDATE projects SET latest_received_at=? WHERE id='sembom'").bind(now).run();
  const m = measured(async index => { if (index === 2) await fixture.db.prepare("DELETE FROM project_grants WHERE project_id='sembom'").run(); });
  const body = parseOverview(await (await handler(m.db)(request())).json());
  assert.deepEqual(body.data[0], { ...emptyOverviewRow('sembom'), error: true, accessDenied: true });
});
test('a rejection read failure retains the newer receipt time from the analytics snapshot', async () => {
  const m = measured(async index => {
    if (index === 2) await fixture.db.prepare("UPDATE projects SET latest_received_at=? WHERE id='sembom'").bind(now).run();
    if (index === 3) throw Error('rejection unavailable');
  });
  const body = parseOverview(await (await handler(m.db)(request())).json()), row = body.data[0]!;
  assert.equal(row.latestReceivedAt, new Date(now).toISOString()); assert.equal(row.events, 0);
  assert.equal(row.rejectionUnavailable, true); assert.equal(row.rejected, null);
});
