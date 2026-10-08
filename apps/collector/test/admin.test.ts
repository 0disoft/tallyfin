import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { CollectionError, dateEnd, DAY, localDate, parseBatch, prepareBatch } from '@tallyfin/core';
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
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'project_grants', 'project_schemas', 'projects'])
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
  for (const suffix of [range + '&schemaVersion=1', range + '&source=server', range.replace('2026-10-08', '2026-02-30'),
    range.replace('2026-10-08', '2026-08-01'), range.replace('2026-10-09', '2026-10-10'),
    '?schemaVersion=1&from=2026-09-01&to=2026-10-09', '?from=2026-10-08&to=2026-10-09'])
    await read(`/v1/projects/sembom/summary${suffix}`, 400);
  await read(`/v1/projects/sembom/events/input_start/daily${range}&groupBy=private`, 400);
  await read('/v1/projects?limit=101', 400); await read('/v1/projects?cursor=../../private', 400);
  const denied = await handler()(request('/v1/projects', 'POST')); assert.equal(denied.status, 405); assert.equal(denied.headers.get('Allow'), 'GET');
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
      .bind('sembom', principal.issuer, principal.subject, 'reader', now).run();
    const get = () => runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/schemas/1',
      { headers: { Authorization: 'Bearer not-a-credential' } });
    const response = await get(); assert.equal(response.status, 200);
    assert.equal((await response.json() as { project: { id: string } }).project.id, 'sembom');
    await db.prepare('DELETE FROM project_grants').run();
    assert.equal((await get()).status, 403);
  } finally { await runtime.dispose(); }
});
