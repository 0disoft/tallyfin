import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, validateRegistry } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import { createCollector } from '../src/handler.ts';
import { migrationStatements, registry as browserRegistry, seed, setup } from '../../../packages/storage-d1/test/helpers.ts';

let f: Awaited<ReturnType<typeof setup>>;
const now = Date.parse('2026-10-09T03:00:00Z');
const reader = { issuer: 'https://identity.example.invalid', subject: 'test-reader' };
const publisher = { issuer: 'https://machine.example.invalid', subject: 'test-publisher' };
const registry = validateRegistry({ ...browserRegistry, events: [...browserRegistry.events, {
  name: 'job_finished', label: 'Job finished', source: 'server', properties: {
    outcome: { type: 'enum', values: ['success', 'failure'], required: true, purpose: 'Job result category' },
    retried: { type: 'boolean', required: false, purpose: 'Retry category' },
    shards: { type: 'integer', minimum: 0, maximum: 1, required: false, purpose: 'Job partition category' },
  },
}] });
const range = '?schemaVersion=1&from=2026-10-08&to=2026-10-09';
const route = (path: string) => '/v1/projects/sembom/' + path;
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['project_publishers', 'project_grants', 'admin_changes', 'workflow_daily_counts', 'event_daily_counts',
    'workflow_attempts', 'event_receipts', 'ingest_daily_usage', 'ingest_minute_usage', 'project_schemas', 'projects'])
    await f.db.prepare(`DELETE FROM ${table}`).run();
  await seed(f.db);
  await f.db.prepare("DELETE FROM project_schemas WHERE project_id='sembom'").run();
  await f.db.prepare("INSERT INTO project_schemas VALUES ('sembom',1,'active',?,?,NULL)")
    .bind(JSON.stringify({ events: registry.events, workflows: registry.workflows }), now).run();
  await f.db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'reader',?)").bind(reader.issuer, reader.subject, now).run();
  await f.db.prepare("INSERT INTO project_publishers (project_id,issuer,subject,created_at) VALUES ('sembom',?,?,?)").bind(publisher.issuer, publisher.subject, now).run();
});
async function read(path: string, status = 200, principal = reader) {
  const handler = createCollector(f.store, { now: () => now, admin: {
    store: new D1Queries(f.db), verifyBearer: async () => principal,
  } });
  const response = await handler(new Request('https://collector.example.invalid' + path, {
    headers: { Authorization: 'Bearer not-a-credential' },
  }));
  assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  return response.json() as Promise<any>;
}
async function collect() {
  const id = crypto.randomUUID();
  const server = { schemaVersion: 1, source: 'server', events: [
    { eventId: id, name: 'job_finished', occurredAt: '2026-10-08T14:59:50Z', properties: { outcome: 'success', retried: false, shards: 0 } },
    { eventId: crypto.randomUUID(), name: 'job_finished', occurredAt: '2026-10-08T15:00:10Z', properties: { outcome: 'success', retried: true, shards: 1 } },
    { eventId: crypto.randomUUID(), name: 'job_finished', occurredAt: '2026-10-08T15:00:11Z', properties: { outcome: 'failure' } },
  ] };
  const prepared = await prepareServerBatch(parseServerBatch(JSON.stringify(server)), registry, now);
  await f.store.commitServer(prepared, registry, publisher);
  await f.store.commitServer(prepared, registry, publisher);
  const browser = { schemaVersion: 1, source: 'browser', events: [{ eventId: id, name: 'tool_view',
    occurredAt: '2026-10-08T15:00:10Z', properties: { tool: 'loan' } }] };
  await f.store.commit(await prepareBatch(parseBatch(JSON.stringify(browser)), registry, now), registry);
}

test('source summaries keep old browser defaults and report only committed server definitions without duplicates', async () => {
  await collect();
  const browser = await read(route('summary' + range));
  assert.equal(browser.meta.source, 'browser'); assert.equal(browser.totalEvents, 1);
  assert.deepEqual(await read(route('summary' + range + '&source=browser')), browser);
  const server = await read(route('summary' + range + '&source=server'));
  assert.equal(server.meta.source, 'server'); assert.equal(server.totalEvents, 3);
  assert.deepEqual(server.events, [{ name: 'job_finished', count: 3 }]);
  assert.equal(server.meta.latestReceivedAt, new Date(now).toISOString());
  assert.equal(server.meta.timeZone, 'Asia/Seoul'); assert.equal(server.meta.coverage, 'observed-only');
});

test('owner can publish a server-only schema with no browser origins, collect it and read empty browser summaries', async () => {
  await f.db.prepare("UPDATE project_grants SET role='owner'").run();
  const handler = createCollector(f.store, { now: () => now,
    admin: { store: new D1Queries(f.db), verifyBearer: async () => reader },
    publisher: { store: f.store, verifyBearer: async () => publisher } });
  const write = (path: string, method: string, body: unknown) => handler(new Request('https://collector.example.invalid' + route(path), {
    method, headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const settings = await read('/v1/projects/sembom');
  const response = await handler(new Request('https://collector.example.invalid/v1/projects/sembom', {
    method: 'PATCH', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedSettingsHash: settings.settingsHash, allowedOrigins: [] }),
  }));
  assert.equal(response.status, 200); assert.deepEqual((await response.json() as any).allowedOrigins, []);
  const definitions = { events: registry.events.filter(event => event.source === 'server'), workflows: [] };
  const valid = await write('schemas/validate', 'POST', definitions);
  assert.equal(valid.status, 200); assert.equal((await valid.json() as any).valid, true);
  const published = await write('schemas/2', 'PUT', { expectedLatestVersion: 1, privacyReviewed: true, ...definitions });
  assert.equal(published.status, 200);
  assert.deepEqual((await read(route('schemas/2'))).allowedOrigins, []);
  const body = { schemaVersion: 2, source: 'server', events: [{ eventId: crypto.randomUUID(), name: 'job_finished',
    occurredAt: new Date(now).toISOString(), properties: { outcome: 'success', retried: false } }] };
  const accepted = await write('server-batches', 'POST', body);
  assert.equal(accepted.status, 200); assert.deepEqual(await accepted.json(), { accepted: 1, duplicates: 0 });
  assert.deepEqual(await (await write('server-batches', 'POST', body)).json(), { accepted: 0, duplicates: 1 });
  const window = range.replace('schemaVersion=1', 'schemaVersion=2');
  assert.equal((await read(route('summary' + window + '&source=server'))).totalEvents, 1);
  const browser = await read(route('summary' + window));
  assert.deepEqual(browser.events, []); assert.equal(browser.totalEvents, 0);
  await read(route('workflows/calculation/daily' + window), 404);
  const denied = await handler(new Request('https://collector.example.invalid' + route('batches'), {
    method: 'POST', headers: { Origin: browserRegistry.allowedOrigins[0]!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, source: 'browser' }),
  }));
  assert.equal(denied.status, 403); assert.equal((await denied.json() as any).error.code, 'origin_denied');
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM workflow_attempts').first<number>('n'), 0);
});

test('server daily counts use project-local dates and registered typed property buckets, including absent, false and zero', async () => {
  await collect();
  const url = route('events/job_finished/daily' + range + '&source=server');
  const plain = await read(url); assert.deepEqual(plain.days.map((d: any) => d.count), [1, 2]);
  assert.ok(plain.days.every((d: any) => d.breakdown.length === 0));
  const boolean = await read(url + '&groupBy=retried');
  assert.deepEqual(boolean.days[0].breakdown, [{ value: false, count: 1 }]);
  assert.deepEqual(boolean.days[1].breakdown, [{ value: null, count: 1 }, { value: true, count: 1 }]);
  const integer = await read(url + '&groupBy=shards');
  assert.deepEqual(integer.days[0].breakdown, [{ value: 0, count: 1 }]);
  assert.equal(integer.totalEvents, 3);
  await read(url + '&groupBy=unknown', 400);
  await read(route('events/job_finished/daily' + range), 404);
  await read(route('events/tool_view/daily' + range + '&source=server'), 404);
});

test('server summaries with no matching definitions or rows are explicit zero; versions and paused projects stay separate', async () => {
  assert.deepEqual((await read(route('summary' + range + '&source=server'))).events, [{ name: 'job_finished', count: 0 }]);
  await collect();
  await f.db.prepare("INSERT INTO project_schemas VALUES ('sembom',2,'active',?,?,NULL)")
    .bind(JSON.stringify({ events: browserRegistry.events, workflows: browserRegistry.workflows }), now).run();
  const empty = await read(route('summary' + range.replace('schemaVersion=1', 'schemaVersion=2') + '&source=server'));
  assert.equal(empty.totalEvents, 0); assert.deepEqual(empty.events, []);
  await f.db.prepare("UPDATE projects SET status='paused'").run();
  await f.db.prepare("UPDATE project_schemas SET status='retired' WHERE version=1").run();
  assert.equal((await read(route('summary' + range + '&source=server'))).totalEvents, 3);
});

test('publisher authority never grants analytics access, and revoked or foreign grants cannot read server data', async () => {
  await collect();
  const path = route('summary' + range + '&source=server');
  await read(path, 403, publisher);
  await read(path, 403, { ...reader, issuer: 'https://other.example.invalid' });
  await seed(f.db, 'foreign');
  await read(path.replace('/sembom/', '/foreign/'), 403);
  await f.db.prepare('DELETE FROM project_grants').run();
  await read(path, 403);
  await read(route('events/job_finished/daily' + range + '&source=server&groupBy=outcome'), 403);
});

test('source parameters are closed and cannot enable server workflows or bypass storage query validation', async () => {
  for (const suffix of ['&source=', '&source=all', '&source=Server', '&source=server&source=browser', '&source[]=server'])
    await read(route('summary' + range + suffix), 400);
  for (const path of ['workflows/calculation/daily', 'workflows/calculation/breakdown'])
    await read(route(path + range + '&source=server&groupBy=tool'), 400);
  await read(route('schemas/1?source=server'), 400);
  const queries = new D1Queries(f.db);
  for (const source of [null, 'all', 'Server'])
    await assert.rejects(queries.query(reader, { projectId: 'sembom', version: 1, kind: 'summary',
      from: '2026-10-08', to: '2026-10-09', source } as any, now), { code: 'invalid_request' });
  await assert.rejects(queries.query(reader, { projectId: 'sembom', version: 1, kind: 'workflow', source: 'server',
    from: '2026-10-08', to: '2026-10-09', name: 'calculation' }, now), { code: 'invalid_request' });
});

test('corrupted server aggregates and property keys fail closed without poisoning the browser source', async () => {
  await collect();
  await f.db.prepare("UPDATE event_daily_counts SET dimension_key='{}' WHERE source='server' AND event_date='2026-10-08'").run();
  await read(route('events/job_finished/daily' + range + '&source=server&groupBy=outcome'), 503);
  assert.equal((await read(route('summary' + range))).totalEvents, 1);
  await f.db.prepare("UPDATE event_daily_counts SET event_name='unregistered' WHERE source='server'").run();
  await read(route('summary' + range + '&source=server'), 503);
});

test('native Worker reads source-filtered counts from real D1 and rechecks the administrator grant', async () => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'ts',
    contents: `import { createWorker } from './apps/collector/src/index.ts';
      export default createWorker(async () => (${JSON.stringify(reader)}));` },
    bundle: true, external: ['cloudflare:workers'], write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    d1Databases: { DB: 'server-query-worker' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await runtime.getD1Database('DB');
    for (const statement of migrationStatements()) await db.prepare(statement).run();
    await seed(db);
    await db.prepare("INSERT INTO project_schemas VALUES ('sembom',2,'active',?,?,NULL)")
      .bind(JSON.stringify({ events: registry.events.filter(event => event.source === 'server'), workflows: [] }), now).run();
    await db.prepare("UPDATE projects SET allowed_origins_json='[]'").run();
    await db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'reader',?)").bind(reader.issuer, reader.subject, now).run();
    await db.prepare("INSERT INTO event_daily_counts VALUES ('sembom',2,'server','2026-10-09','job_finished',?,4,?)")
      .bind('[["outcome","string","success"],["retried","boolean",false],["shards","number",0]]', now).run();
    const fetch = (path: string) => runtime.dispatchFetch('https://collector.example.invalid' + path,
      { headers: { Authorization: 'Bearer not-a-credential' } });
    const query = range.replace('schemaVersion=1', 'schemaVersion=2');
    const summary = await fetch(route('summary' + query + '&source=server'));
    assert.equal(summary.status, 200); const counts = await summary.json() as any;
    assert.equal(counts.meta.source, 'server'); assert.equal(counts.totalEvents, 4);
    assert.equal((await (await fetch(route('summary' + query))).json() as any).totalEvents, 0);
    const daily = await (await fetch(route('events/job_finished/daily' + query + '&source=server&groupBy=shards'))).json() as any;
    assert.deepEqual(daily.days[1].breakdown, [{ value: 0, count: 4 }]);
    await db.prepare('DELETE FROM project_grants').run();
    assert.equal((await fetch(route('summary' + query + '&source=server'))).status, 403);
  } finally { await runtime.dispose(); }
});
