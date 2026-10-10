import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { CollectionError, dateEnd, DAY, dimensionKey, localDate, parseBatch, prepareBatch } from '@tallyfin/core';
import type { AdminPrincipal } from '@tallyfin/core';
import { D1Queries, D1Store } from '@tallyfin/storage-d1';
import { setup, seed, registry, migrationStatements } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { fileURLToPath } from 'node:url';

let fixture: Awaited<ReturnType<typeof setup>>;
const now = Date.parse('2026-10-09T03:00:00Z');
const principal: AdminPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-admin' };
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'admin_changes', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
  await grant('sembom');
});
async function grant(project: string, role = 'reader', identity = principal) {
  await fixture.db.prepare('INSERT INTO project_grants (project_id, issuer, subject, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(project, identity.issuer, identity.subject, role, now).run();
}
function handler(verifier: (() => Promise<AdminPrincipal | null>) | undefined = async () => principal) {
  const store = new D1Store(fixture.db);
  // The bearer below is deliberately not a credential; these tests exercise a mocked trusted port.
  return createCollector(store, { now: () => now, ...(verifier ? { admin: { store: new D1Queries(fixture.db), verifyBearer: verifier } } : {}) });
}
const request = (path: string, method = 'GET', authorization: string | null = 'Bearer not-a-credential') => new Request(`https://collector.example.invalid${path}`, {
  method, headers: authorization ? { Authorization: authorization } : {},
});
const range = '?schemaVersion=1&from=2026-10-08&to=2026-10-09';
async function read(path: string, status = 200) {
  const response = await handler()(request(path)); assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json() as Promise<any>;
}
async function events() {
  const start = '2026-10-08T14:59:50.000Z';
  const attempt = { workflowId: 'calculation', attemptId: crypto.randomUUID(), startedAt: start };
  const input = { schemaVersion: 1, source: 'browser', events: [
    { eventId: crypto.randomUUID(), name: 'input_start', occurredAt: start, properties: { tool: 'loan' }, attempt },
    { eventId: crypto.randomUUID(), name: 'calculation_success', occurredAt: '2026-10-08T15:00:10Z', properties: { tool: 'loan' }, attempt },
    { eventId: crypto.randomUUID(), name: 'validation_error', occurredAt: '2026-10-08T15:00:10Z', properties: { tool: 'loan' } },
    { eventId: crypto.randomUUID(), name: 'validation_error', occurredAt: '2026-10-08T15:00:11Z', properties: { tool: 'loan', error: 'required' } },
  ] };
  await fixture.store.commit(await prepareBatch(parseBatch(JSON.stringify(input)), registry, now), registry);
}
test('administrator authentication is closed without a verifier or on invalid identity/exception', async () => {
  for (const verify of [null, async () => null, async () => { throw Error('private verifier detail'); }, async () => ({ issuer: '', subject: 'x' })]) {
    const h = verify === null ? createCollector(fixture.store) : handler(verify);
    const response = await h(request('/v1/projects'));
    assert.equal(response.status, 401); assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
    assert.ok(!(await response.text()).includes('private verifier detail'));
  }
  assert.equal((await handler()(request('/v1/projects', 'GET', null))).status, 401);
  assert.equal((await handler()(request('/v1/projects', 'GET', 'Bearer not-a-credential,other'))).status, 401);
});
test('project pages reapply grants, cursor is only a position, and issuer is part of identity', async () => {
  await seed(fixture.db, 'alpha'); await seed(fixture.db, 'zeta');
  await grant('alpha', 'owner'); await grant('zeta', 'reader', { ...principal, issuer: 'https://different.example.invalid' });
  const first = await read('/v1/projects?limit=1'); assert.deepEqual(first.data.map((p: any) => p.id), ['alpha']);
  assert.equal(first.page.nextCursor, 'alpha');
  const next = await read('/v1/projects?limit=1&cursor=alpha'); assert.deepEqual(next.data.map((p: any) => p.id), ['sembom']);
  assert.equal(next.page.nextCursor, null);
  await fixture.db.prepare('DELETE FROM project_grants WHERE project_id = ?').bind('sembom').run();
  assert.deepEqual((await read('/v1/projects?cursor=alpha')).data, []);
  for (const route of ['/schemas/1', `/summary${range}`, `/events/input_start/daily${range}`, `/workflows/calculation/daily${range}`])
    assert.equal((await read(`/v1/projects/sembom${route}`, 403)).error.code, 'forbidden');
  assert.equal((await read('/v1/projects/zeta/schemas/1', 403)).error.code, 'forbidden');
});
test('summary and daily event dates differ from workflow start cohorts; absent buckets stay null', async () => {
  await events();
  const summary = await read(`/v1/projects/sembom/summary${range}`);
  assert.equal(summary.totalEvents, 4); assert.equal(summary.meta.coverage, 'observed-only');
  assert.equal(summary.meta.timeZone, 'Asia/Seoul'); assert.equal(summary.events.find((e: any) => e.name === 'tool_view').count, 0);
  const event = await read(`/v1/projects/sembom/events/calculation_success/daily${range}`);
  assert.deepEqual(event.days.map((d: any) => d.count), [0, 1]);
  const buckets = await read(`/v1/projects/sembom/events/validation_error/daily${range}&groupBy=error`);
  assert.deepEqual(buckets.days[1].breakdown, [{ value: 'required', count: 1 }, { value: null, count: 1 }]);
  const goal = await read(`/v1/projects/sembom/workflows/calculation/daily${range}`);
  assert.deepEqual(goal.summary, { startedAttempts: 1, succeededAttempts: 1, failedAttempts: null, pendingAttempts: 0, completionRate: 100 });
  assert.deepEqual(goal.days.map((d: any) => d.startedAttempts), [1, 0]);
  assert.equal(goal.days[1].completionRate, null); assert.equal(goal.days[0].provisional, true);
});

test('workflow grouping uses start cohorts, reconciles with daily totals and preserves empty and zero-start days', async () => {
  await events();
  await fixture.db.prepare('INSERT INTO workflow_daily_counts VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind('sembom',1,'browser','2026-10-08','calculation',dimensionKey({tool:'grade'},['tool']),3,1,0,now).run();
  const result = await read(`/v1/projects/sembom/workflows/calculation/breakdown${range}&groupBy=tool`);
  const daily = await read(`/v1/projects/sembom/workflows/calculation/daily${range}`);
  assert.deepEqual(result.summary,daily.summary); assert.equal(result.groupBy,'tool'); assert.equal(result.cohortBasis,'startedAt');
  const loan = result.buckets.find((bucket: any) => bucket.value === 'loan');
  assert.equal(loan.summary.startedAttempts,1); assert.equal(loan.summary.completionRate,100);
  assert.equal(loan.days[0].succeededAttempts,1); assert.equal(loan.days[1].startedAttempts,0); assert.equal(loan.days[1].completionRate,null);
  const grade = result.buckets.find((bucket: any) => bucket.value === 'grade'); assert.equal(grade.summary.pendingAttempts,2);
  assert.equal(result.summary.completionRate,50); // (1+1)/(1+3), not the average of 100 and 33.3.
  const empty = await read('/v1/projects/sembom/workflows/calculation/breakdown?schemaVersion=1&from=2026-10-07&to=2026-10-07&groupBy=tool');
  assert.deepEqual(empty.buckets,[]);assert.equal(empty.summary.completionRate,null);
});

test('workflow breakdown enforces grants, registered dimensions, parameters and corrupted storage failure', async () => {
  const path = `/v1/projects/sembom/workflows/calculation/breakdown${range}`;
  for (const suffix of ['', '&groupBy=error','&groupBy=tool&groupBy=tool','&groupBy=','&groupBy=tool&source=server']) await read(path+suffix,400);
  await read(path.replace('/calculation/','/unknown/')+'&groupBy=tool',404);
  await read(path.replace('Version=1','Version=2')+'&groupBy=tool',404);
  await events();
  await fixture.db.prepare("UPDATE workflow_daily_counts SET dimension_key='[]'").run();
  await read(path+'&groupBy=tool',503);
  await fixture.db.prepare("DELETE FROM project_grants WHERE project_id='sembom'").run();
  await read(path+'&groupBy=tool',403);
  assert.equal((await handler()(request(path+'&groupBy=tool','GET',null))).status,401);
});

test('workflow buckets keep boolean false and integer zero as typed values across schema versions', async () => {
  for (const [version,rule,value] of [[2,{type:'boolean',required:true,purpose:'Public flag'},false],
    [3,{type:'integer',required:true,purpose:'Public range',minimum:0,maximum:1},0]] as const) {
    const definitions=structuredClone({events:registry.events,workflows:registry.workflows});
    for (const name of ['input_start','calculation_success']) definitions.events.find(event=>event.name===name)!.properties.tool=rule;
    await fixture.db.prepare('INSERT INTO project_schemas VALUES (?,?,?,?,?,NULL)').bind('sembom',version,'active',JSON.stringify(definitions),now).run();
    await fixture.db.prepare('INSERT INTO workflow_daily_counts VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind('sembom',version,'browser','2026-10-08','calculation',dimensionKey({tool:value},['tool']),2,1,0,now).run();
    const result=await read(`/v1/projects/sembom/workflows/calculation/breakdown${range.replace('Version=1',`Version=${version}`)}&groupBy=tool`);
    assert.equal(result.buckets[0].value,value);assert.equal(result.buckets[0].summary.completionRate,50);
  }
});

test('one workflow grouping merges other dimensions and retains actual failure counts', async () => {
  const definitions=structuredClone({events:registry.events,workflows:registry.workflows});
  definitions.workflows[0]!.failureEvent='validation_error';definitions.workflows[0]!.dimensions=['tool','flag'];
  for (const name of ['input_start','calculation_success','validation_error'])
    definitions.events.find(event=>event.name===name)!.properties.flag={type:'boolean',required:true,purpose:'Public flag'};
  await fixture.db.prepare('INSERT INTO project_schemas VALUES (?,?,?,?,?,NULL)').bind('sembom',4,'active',JSON.stringify(definitions),now).run();
  for (const [flag,start,success,failed] of [[false,8,4,2],[true,2,1,0]] as const)
    await fixture.db.prepare('INSERT INTO workflow_daily_counts VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind('sembom',4,'browser','2026-10-08','calculation',dimensionKey({tool:'loan',flag},['tool','flag']),start,success,failed,now).run();
  const result=await read(`/v1/projects/sembom/workflows/calculation/breakdown${range.replace('Version=1','Version=4')}&groupBy=tool`);
  assert.equal(result.buckets.length,1);assert.equal(result.buckets[0].value,'loan');
  assert.deepEqual(result.buckets[0].summary,{startedAttempts:10,succeededAttempts:5,failedAttempts:2,pendingAttempts:3,completionRate:50});
});
test('retired versions and paused projects remain readable; different versions do not merge', async () => {
  await events();
  await fixture.db.prepare("UPDATE projects SET status='paused'").run();
  await fixture.db.prepare("UPDATE project_schemas SET status='retired'").run();
  assert.equal((await read('/v1/projects/sembom/schemas/1')).schemaStatus, 'retired');
  assert.equal((await read(`/v1/projects/sembom/summary${range}`)).totalEvents, 4);
  await fixture.db.prepare("INSERT INTO project_schemas (project_id, version, status, definitions_json, published_at) SELECT project_id, 2, 'active', definitions_json, published_at FROM project_schemas WHERE version=1").run();
  assert.equal((await read(`/v1/projects/sembom/summary${range.replace('Version=1', 'Version=2')}`)).totalEvents, 0);
});
test('unknown schemas/definitions, invalid dates/grouping and duplicate parameters are rejected', async () => {
  for (const suffix of ['/schemas/2', `/events/unknown/daily${range}`, `/workflows/unknown/daily${range}`])
    assert.equal((await read(`/v1/projects/sembom${suffix}`, 404)).error.code, 'not_found');
  for (const suffix of [range + '&schemaVersion=1', range + '&source=all', range.replace('2026-10-08', '2026-02-30'),
    range.replace('2026-10-08', '2026-08-01'), range.replace('2026-10-09', '2026-10-10'),
    '?schemaVersion=1&from=2026-09-01&to=2026-10-09', '?from=2026-10-08&to=2026-10-09'])
    await read(`/v1/projects/sembom/summary${suffix}`, 400);
  await read(`/v1/projects/sembom/events/input_start/daily${range}&groupBy=private`, 400);
  await read('/v1/projects?limit=101', 400); await read('/v1/projects?cursor=../../private', 400);
  const denied = await handler()(request('/v1/projects', 'PUT')); assert.equal(denied.status, 405); assert.equal(denied.headers.get('Allow'), 'GET, POST');
});
test('grant revoked before the database snapshot cannot reveal a schema or aggregate', async () => {
  const proxy = { prepare: fixture.db.prepare.bind(fixture.db), async batch(statements: any[]) {
    await fixture.db.prepare('DELETE FROM project_grants').run(); return fixture.db.batch(statements);
  } };
  await assert.rejects(new D1Queries(proxy).query(principal, { projectId: 'sembom', version: 1, kind: 'summary', from: '2026-10-08', to: '2026-10-09' }, now),
    (error: unknown) => error instanceof CollectionError && error.code === 'forbidden');
});
test('storage corruption and aggregate overflow return 503 instead of fabricated zero data', async () => {
  const incomplete = new D1Queries({ prepare: fixture.db.prepare.bind(fixture.db), batch: async () => [] });
  await assert.rejects(incomplete.query(principal, { projectId: 'sembom', version: 1, kind: 'summary', from: '2026-10-08', to: '2026-10-09' }, now),
    (error: unknown) => error instanceof CollectionError && error.code === 'storage_unavailable');
  await fixture.db.prepare("INSERT INTO event_daily_counts (project_id,schema_version,source,event_date,event_name,dimension_key,count,updated_at) VALUES ('sembom',1,'browser','2026-10-08','tool_view',?, ?, ?)")
    .bind('[["tool","string","loan"]]', Number.MAX_SAFE_INTEGER, now).run();
  await fixture.db.prepare("INSERT INTO event_daily_counts (project_id,schema_version,source,event_date,event_name,dimension_key,count,updated_at) VALUES ('sembom',1,'browser','2026-10-08','tool_view',?, 1, ?)")
    .bind('[["tool","string","timer"]]', now).run();
  assert.equal((await read(`/v1/projects/sembom/summary${range}`, 503)).error.code, 'storage_unavailable');
  await fixture.db.prepare('DROP TABLE event_daily_counts').run();
  assert.equal((await read(`/v1/projects/sembom/summary${range}`, 503)).error.code, 'storage_unavailable');
  await fixture.db.prepare(migrationStatements().find(sql => sql.startsWith('CREATE TABLE event_daily_counts'))!).run();
});
test('provisional date boundaries follow local midnight and DST, not UTC midnight', () => {
  assert.equal(dateEnd('2026-10-08', 'Asia/Seoul'), Date.parse('2026-10-08T15:00:00Z'));
  const end = dateEnd('2026-03-08', 'America/New_York');
  assert.equal(end, Date.parse('2026-03-09T04:00:00Z'));
  assert.equal(localDate(end - 1, 'America/New_York'), '2026-03-08');
  assert.equal(localDate(end, 'America/New_York'), '2026-03-09');
  assert.equal(end - dateEnd('2026-03-07', 'America/New_York'), 23 * DAY / 24);
});

test('configured administrator factory runs in the real Worker runtime with D1 grants', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const bundle = await build({ stdin: {
    contents: `import { createWorker } from './apps/collector/src/index.ts';
      export default createWorker(async () => (${JSON.stringify(principal)}));`,
    resolveDir: root, loader: 'ts',
  }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    d1Databases: { DB: 'tallyfin-admin-runtime-test' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await runtime.getD1Database('DB');
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await seed(db);
    await db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
      .bind('sembom', principal.issuer, principal.subject, 'owner', now).run();
    const get = () => runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/schemas/1',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    const response = await get(); assert.equal(response.status, 200);
    assert.equal((await response.json() as { project: { id: string } }).project.id, 'sembom');
    const settings = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    const snapshot = await settings.json() as { settingsHash: string };
    const patched = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom', {
      method: 'PATCH', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedSettingsHash: snapshot.settingsHash, name: 'Worker settings update' }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json() as { project: { name: string } }).project.name, 'Worker settings update');
    const validated = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/schemas/validate', {
      method: 'POST', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: registry.events, workflows: registry.workflows }),
    });
    assert.equal(validated.status, 200);
    assert.deepEqual(await validated.json(), { valid: true, issues: [], privacyReviewRequired: true });
    const published = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/schemas/2', {
      method: 'PUT', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedLatestVersion: 1, privacyReviewed: true, events: registry.events, workflows: registry.workflows }),
    });
    assert.equal(published.status, 200); assert.equal((await published.json() as { schemaVersion: number }).schemaVersion, 2);
    await db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(principal.issuer, principal.subject, now).run();
    const create = () => runtime.dispatchFetch('https://collector.example.invalid/v1/projects', {
      method: 'POST', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'worker-created', name: 'Worker created', timeZone: 'UTC', allowedOrigins: ['https://new.example.invalid'],
        limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 } }),
    });
    const created = await create(); assert.equal(created.status, 200);
    assert.deepEqual(await (await create()).json(), await created.json());
    const freshSchemas = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/schemas',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    assert.equal(freshSchemas.status, 200); assert.equal((await freshSchemas.json() as { latestVersion: number | null }).latestVersion, null);
    const grants = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/grants',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    assert.equal(grants.status, 200); assert.equal(grants.headers.get('Cache-Control'), 'no-store');
    const grantCreatedAt = await db.prepare("SELECT created_at FROM project_grants WHERE project_id='worker-created'").first<number>('created_at');
    assert.ok(grantCreatedAt !== null);
    assert.deepEqual((await grants.json() as { data: unknown[] }).data,
      [{ ...principal, role: 'owner', createdAt: new Date(grantCreatedAt).toISOString() }]);
    await db.prepare("INSERT INTO project_grants VALUES ('worker-created',?,?,'reader',?)").bind(principal.issuer, 'z-reader', now).run();
    const grantPage = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/grants?limit=1',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    const grantCursor = (await grantPage.json() as { page: { nextCursor: string } }).page.nextCursor;
    assert.ok(grantCursor);
    const nextGrants = await runtime.dispatchFetch(`https://collector.example.invalid/v1/projects/worker-created/grants?cursor=${grantCursor}`,
      { headers: { Authorization: 'Bearer not-a-credential' } });
    assert.equal(nextGrants.status, 200);
    assert.deepEqual((await nextGrants.json() as { data: unknown[] }).data,
      [{ issuer: principal.issuer, subject: 'z-reader', role: 'reader', createdAt: new Date(now).toISOString() }]);
    const grantUpdate = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/grants', {
      method: 'PUT', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuer: principal.issuer, subject: 'z-reader', role: 'owner', expectedRole: 'reader' }),
    });
    assert.equal(grantUpdate.status, 200); assert.equal((await grantUpdate.json() as { role: string }).role, 'owner');
    const grantDelete = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/grants', {
      method: 'DELETE', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
      body: JSON.stringify({ issuer: principal.issuer, subject: 'z-reader', expectedRole: 'owner' }),
    });
    assert.equal(grantDelete.status, 200); assert.equal((await grantDelete.json() as { role: string | null }).role, null);
    const history = await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/changes?limit=2',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    assert.equal(history.status, 200); assert.equal(history.headers.get('Cache-Control'), 'no-store');
    const historyPage = await history.json() as { coverage: string; data: { change: { action: string } }[]; page: { nextCursor: string } };
    assert.equal(historyPage.coverage, 'recorded-changes-only');
    assert.deepEqual(historyPage.data.map(row => row.change.action), ['grant.revoked', 'grant.role_changed']);
    assert.ok(historyPage.page.nextCursor);
    const olderHistory = await runtime.dispatchFetch(`https://collector.example.invalid/v1/projects/worker-created/changes?cursor=${historyPage.page.nextCursor}`,
      { headers: { Authorization: 'Bearer not-a-credential' } });
    assert.equal(olderHistory.status, 200);
    assert.deepEqual((await olderHistory.json() as { data: { change: { action: string } }[] }).data.map(row => row.change.action), ['project.created']);
    await db.prepare('DELETE FROM project_grants').run();
    assert.equal((await get()).status, 403);
    assert.equal((await runtime.dispatchFetch('https://collector.example.invalid/v1/projects/worker-created/changes',
      { headers: { Authorization: 'Bearer not-a-credential' } })).status, 403);
  } finally { await runtime.dispose(); }
});
