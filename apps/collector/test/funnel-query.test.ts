import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { DAY, dateEnd, dimensionKey, funnelCounts, parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, validateRegistry } from '@tallyfin/core';
import type { FunnelQueryMeta, FunnelResponse } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '@tallyfin/storage-d1';
import { funnelSeries } from '../../../packages/storage-d1/src/funnel-query.ts';
import { example, setup } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

const registry = validateRegistry(example('funnel-registry'));
const principal = { issuer: 'https://identity.example.invalid', subject: 'test-reader' };
const publisher = { issuer: 'https://machine.example.invalid', subject: 'test-publisher' };
const now = Date.parse('2026-10-11T03:00:00Z');
const base = '/v1/projects/modufile/funnels/conversion/daily';
const range = '?schemaVersion=1&from=2026-10-08&to=2026-10-11';
let f: Awaited<ReturnType<typeof setup>>;
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['funnel_runs', 'funnel_daily_counts', 'project_publishers', 'project_grants', 'admin_changes',
    'workflow_attempts', 'workflow_daily_counts', 'event_receipts', 'event_daily_counts', 'ingest_daily_usage',
    'ingest_minute_usage', 'project_schemas', 'projects']) await f.db.prepare(`DELETE FROM ${table}`).run();
  await f.db.prepare(`INSERT INTO projects (id,name,status,time_zone,allowed_origins_json,requests_per_minute,new_receipts_per_utc_day,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind('modufile', 'ModuFile', 'active', registry.project.timeZone,
    JSON.stringify(registry.allowedOrigins), 120, 100000, now).run();
  await f.db.prepare("INSERT INTO project_schemas VALUES ('modufile',1,'active',?,?,NULL)")
    .bind(JSON.stringify({ events: registry.events, workflows: [], funnels: registry.funnels }), now).run();
  await f.db.prepare("INSERT INTO project_grants VALUES ('modufile',?,?, 'reader',?)")
    .bind(principal.issuer, principal.subject, now).run();
});
function handler(at = now, identity: typeof principal | null = principal, queries = new D1Queries(f.db)) {
  return createCollector(f.store, { now: () => at, admin: { store: queries, verifyBearer: async () => identity } });
}
async function read(path = base + range, status = 200, at = now, identity: typeof principal | null = principal, method = 'GET') {
  const response = await handler(at, identity)(new Request('https://collector.example.invalid' + path,
    { method, headers: { Authorization: 'Bearer not-a-credential' } }));
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  if (status === 405) assert.equal(response.headers.get('Allow'), 'GET');
  return response.json() as Promise<FunnelResponse>;
}
async function rows(date: string, values: number[], kind = 'pdf', version = 1, project = 'modufile') {
  for (const [index, count] of values.entries())
    await f.db.prepare('INSERT INTO funnel_daily_counts VALUES (?,?,?,?,?,?,?,?)')
      .bind(project, version, date, 'conversion', dimensionKey({ kind }, ['kind']), index, count, now).run();
}

test('funnel daily query combines dimensions, fills dates and derives rates from totals, not mean daily rates', async () => {
  await rows('2026-10-08', [10, 8, 7, 5]); await rows('2026-10-08', [1, 1, 1, 1], 'image');
  await rows('2026-10-09', [2, 1, 1, 0]);
  const result = await read();
  assert.deepEqual(result.summary, funnelCounts([13, 10, 9, 6]));
  assert.deepEqual(result.days.map(day => day.startedRuns), [11, 2, 0, 0]);
  assert.deepEqual(result.days[2]!.steps.map(step => step.reachRate), [null, null, null, null]);
  assert.equal(result.summary.steps[0]!.conversionRate, null);
  assert.deepEqual(result.summary.steps.map(step => step.notReachedNext), [3, 1, 3, null]);
  assert.deepEqual(result.definition, registry.funnels![0]); assert.equal(result.cohortBasis, 'startedAt');
  assert.equal(result.funnelId, 'conversion'); assert.equal(Object.hasOwn(result.meta, 'source'), false);
  assert.deepEqual(result.definition.steps.map(step => step.source), ['browser', 'browser', 'server', 'server']);
  assert.deepEqual(result.days.map(day => day.provisional), [false, true, true, true]);
});

test('observed browser and authenticated server stages use start-day cohorts despite reverse receipt order and retries', async () => {
  await f.db.prepare('INSERT INTO project_publishers VALUES (?,?,?,?)').bind('modufile', publisher.issuer, publisher.subject, now).run();
  const started = Date.parse('2026-10-10T14:59:59Z');
  const link = { funnelId: 'conversion', runId: crypto.randomUUID(), startedAt: new Date(started).toISOString() };
  const deliver = async (index: number) => {
    const step = registry.funnels![0]!.steps[index]!;
    const body = JSON.stringify({ schemaVersion: 1, source: step.source, events: [{ eventId: crypto.randomUUID(),
      name: step.eventName, occurredAt: new Date(started + index * 2000).toISOString(), properties: { kind: 'pdf' }, funnel: link }] });
    if (step.source === 'server') return f.store.commitServer(await prepareServerBatch(parseServerBatch(body), registry, now), registry, publisher);
    return f.store.commit(await prepareBatch(parseBatch(body), registry, now), registry);
  };
  await deliver(3); await deliver(0);
  assert.deepEqual((await read()).summary, funnelCounts([1, 0, 0, 0]));
  await deliver(2); await deliver(1); await deliver(3);
  const result = await read(); assert.deepEqual(result.summary, funnelCounts([1, 1, 1, 1]));
  assert.equal(result.days[2]!.completedRuns, 1); assert.equal(result.days[3]!.startedRuns, 0);
  assert.ok(!JSON.stringify(result).includes(link.runId));
});

test('empty cohorts keep null rates and cross-source/server-only definitions stay queryable', async () => {
  const definitions = { events: registry.events.filter(event => event.source === 'server'), workflows: [],
    funnels: [{ ...registry.funnels![0]!, steps: registry.funnels![0]!.steps.slice(2) }] };
  await f.db.prepare("INSERT INTO project_schemas VALUES ('modufile',2,'active',?,?,NULL)").bind(JSON.stringify(definitions), now).run();
  const result = await read(base + range.replace('Version=1', 'Version=2'));
  assert.deepEqual(result.summary, funnelCounts([0, 0]));
  assert.deepEqual(result.definition.steps.map(step => step.source), ['server', 'server']);
  assert.ok(result.days.every(day => day.completionRate === null));
});

test('reader/owner queries reapply issuer/subject grants; revoked, publisher-only and unauthenticated principals cannot read', async () => {
  await rows('2026-10-08', [1, 1, 1, 1]);
  await read(); await f.db.prepare("UPDATE project_grants SET role='owner'").run(); await read();
  await f.db.prepare('INSERT INTO project_publishers VALUES (?,?,?,?)').bind('modufile', publisher.issuer, publisher.subject, now).run();
  await read(base + range, 403, now, { ...principal, issuer: 'https://different.example.invalid' });
  await read(base + range, 403, now, publisher);
  await read(base + range, 401, now, null);
  const delegate = f.db as unknown as SqlDatabase;
  const revoked = new D1Queries({ prepare: sql => {
    assert.match(sql, /EXISTS \(SELECT 1 FROM project_grants/); return delegate.prepare(sql);
  }, batch: async <T>(statements: SqlStatement[]) => {
    assert.equal(statements.length, 3);
    await f.db.prepare('DELETE FROM project_grants').run(); // Access changed after statements were prepared.
    return delegate.batch<T>(statements);
  } });
  const response = await handler(now, principal, revoked)(new Request('https://collector.example.invalid' + base + range,
    { headers: { Authorization: 'Bearer not-a-credential' } }));
  assert.equal(response.status, 403); assert.equal((await response.json() as any).error.code, 'forbidden');
  await read(base + range, 403);
  await read(base.replace('/modufile/', '/missing/') + range, 403);
});

test('paused projects and retired schemas remain readable while versions and projects are isolated', async () => {
  await rows('2026-10-08', [4, 3, 2, 1]);
  const definitions = JSON.stringify({ events: registry.events, workflows: [], funnels: registry.funnels });
  await f.db.prepare("INSERT INTO project_schemas VALUES ('modufile',2,'active',?,?,NULL)").bind(definitions, now).run();
  await rows('2026-10-08', [100, 100, 100, 100], 'pdf', 2);
  await f.db.prepare("INSERT INTO projects (id,name,status,time_zone,allowed_origins_json,requests_per_minute,new_receipts_per_utc_day,created_at) VALUES ('other','Other','active','UTC','[]',120,100000,?)").bind(now).run();
  await f.db.prepare("INSERT INTO project_schemas VALUES ('other',1,'active',?,?,NULL)").bind(definitions, now).run();
  await rows('2026-10-08', [200, 200, 200, 200], 'pdf', 1, 'other');
  await f.db.prepare("UPDATE projects SET status='paused' WHERE id='modufile'").run();
  await f.db.prepare("UPDATE project_schemas SET status='retired' WHERE project_id='modufile' AND version=1").run();
  assert.deepEqual((await read()).summary, funnelCounts([4, 3, 2, 1]));
  assert.equal((await read(base + range.replace('Version=1', 'Version=2'))).summary.startedRuns, 100);
  await read(base.replace('/conversion/', '/unknown/') + range, 404);
  await read(base + range.replace('Version=1', 'Version=3'), 404);
  await f.db.prepare("INSERT INTO project_schemas VALUES ('modufile',3,'active',?,?,NULL)")
    .bind(JSON.stringify({ events: registry.events, workflows: [] }), now).run();
  await read(base + range.replace('Version=1', 'Version=3'), 404);
});

test('query parameters are closed and bounded by project-local calendar retention and cohort maturity', async () => {
  for (const suffix of ['&source=browser', '&source=server', '&groupBy=kind', '&runId=x', '&from=2026-10-08', '&schemaVersion=1'])
    await read(base + range + suffix, 400);
  for (const query of ['?from=2026-10-08&to=2026-10-11', '?schemaVersion=01&from=2026-10-08&to=2026-10-11',
    '?schemaVersion=1&from=2026-10-12&to=2026-10-12', '?schemaVersion=1&from=2026-09-01&to=2026-10-11',
    '?schemaVersion=1&from=2026-10-11&to=2026-10-08', '?schemaVersion=1&from=2026-02-30&to=2026-10-11']) await read(base + query, 400);
  const earliest = new Date(Date.parse('2026-10-11') - 89 * DAY).toISOString().slice(0, 10);
  await read(base + `?schemaVersion=1&from=${earliest}&to=${earliest}`);
  const expired = new Date(Date.parse(earliest) - DAY).toISOString().slice(0, 10);
  await read(base + `?schemaVersion=1&from=${expired}&to=${expired}`, 400);
  const full = await read(base + '?schemaVersion=1&from=2026-09-11&to=2026-10-11');
  assert.equal(full.days.length, 31);
  const edge = dateEnd('2026-10-09', 'Asia/Seoul') + 2 * DAY;
  const query = base + '?schemaVersion=1&from=2026-10-09&to=2026-10-09';
  assert.equal((await read(query, 200, edge - 1)).days[0]!.provisional, true);
  assert.equal((await read(query, 200, edge)).days[0]!.provisional, false);
  await read(base + range, 405, now, principal, 'POST');
  for (const input of [{ source: 'server' }, { groupBy: 'kind' }, { name: undefined }])
    await assert.rejects(new D1Queries(f.db).query(principal, { projectId: 'modufile', version: 1, kind: 'funnel',
      name: 'conversion', from: '2026-10-08', to: '2026-10-11', ...input }, now), { code: 'invalid_request' });
});

test('storage failures and grouped overflow fail closed, never return fabricated zero results', async () => {
  await rows('2026-10-08', Array(4).fill(Number.MAX_SAFE_INTEGER));
  assert.equal((await read()).summary.startedRuns, Number.MAX_SAFE_INTEGER);
  await rows('2026-10-08', [1, 1, 1, 1], 'image');
  await read(base + range, 503);
  await f.db.prepare('DELETE FROM funnel_daily_counts').run();
  await rows('2026-10-08', Array(4).fill(Number.MAX_SAFE_INTEGER));
  await rows('2026-10-09', [1, 1, 1, 1]); // Every day fits, the range total does not.
  await read(base + range, 503);
  const unavailable = new D1Queries({ prepare: sql => f.db.prepare(sql), batch: async () => { throw Error('private storage detail'); } });
  const response = await handler(now, principal, unavailable)(new Request('https://collector.example.invalid' + base + range,
    { headers: { Authorization: 'Bearer not-a-credential' } }));
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private storage detail'));
});

test('funnel projection rejects duplicate/out-of-range rows and per-day order violations, including balanced range totals', () => {
  const input = { projectId: 'modufile', version: 1, kind: 'funnel' as const, name: 'conversion' };
  const meta: FunnelQueryMeta = { projectId: 'modufile', schemaVersion: 1, from: '2026-10-08', to: '2026-10-09',
    timeZone: 'Asia/Seoul', generatedAt: new Date(now).toISOString(), latestReceivedAt: null, coverage: 'observed-only' };
  const row = { cohort_date: '2026-10-08', step_index: 0, reached_count: 1 };
  for (const rows of [[row, row], [{ ...row, step_index: 4 }], [{ ...row, step_index: -1 }],
    [{ ...row, cohort_date: '2026-10-10' }], [{ ...row, reached_count: -1 }], [{ ...row, reached_count: 0.5 }],
    [{ ...row, step_index: 1 }], [row, { ...row, step_index: 1, reached_count: 2 },
      { ...row, cohort_date: '2026-10-09', reached_count: 10 }], Array(9).fill(row)])
    assert.throws(() => funnelSeries(registry, input, meta, ['2026-10-08', '2026-10-09'], rows, now), { code: 'storage_unavailable' });
});
