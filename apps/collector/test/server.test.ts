import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { UUID } from '@tallyfin/core';
import { D1Queries, D1Store } from '@tallyfin/storage-d1';
import { createCollector } from '../src/handler.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import { example, migrationStatements, now, registry, seed, setup } from '../../../packages/storage-d1/test/helpers.ts';

let f: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://machine.example.invalid', subject: 'test-service' };
const definition = { name: 'job_finished', label: 'Job finished', source: 'server', properties: {
  outcome: { type: 'enum', values: ['success', 'failure'], required: true, purpose: 'Job result category' },
  retried: { type: 'boolean', required: false, purpose: 'Retry category' },
} };
const input = () => example('server-batch');
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['project_publishers', 'project_grants', 'admin_changes', 'workflow_daily_counts', 'event_daily_counts',
    'workflow_attempts', 'event_receipts', 'ingest_daily_usage', 'ingest_minute_usage', 'project_schemas'])
    await f.db.prepare(`DELETE FROM ${table}`).run();
  await f.db.prepare("UPDATE projects SET status='active', ingest_revision=0, latest_received_at=NULL, requests_per_minute=120, new_receipts_per_utc_day=100000").run();
  await f.db.prepare("INSERT INTO project_schemas VALUES ('sembom',1,'active',?,?,NULL)")
    .bind(JSON.stringify({ events: [...registry.events, definition], workflows: registry.workflows }), now).run();
});
const permit = () => f.db.prepare('INSERT INTO project_publishers (project_id,issuer,subject,created_at) VALUES (?,?,?,?)').bind('sembom', principal.issuer, principal.subject, now).run();
const count = (table: string) => f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>('n');
// Deliberately non-credential bearer; HTTP unit tests supply a trusted mocked verifier.
const request = (body: string | Uint8Array = JSON.stringify(input()), options: {
  method?: string; authorization?: string | null; headers?: Record<string, string>; path?: string;
} = {}) => new Request(`https://collector.example.invalid${options.path ?? '/v1/projects/sembom/server-batches'}`, {
  method: options.method ?? 'POST',
  headers: { 'Content-Type': 'application/json',
    ...(options.authorization === null ? {} : { Authorization: options.authorization ?? 'Bearer not-a-credential' }), ...options.headers },
  ...(['GET', 'OPTIONS'].includes(options.method ?? '') ? {} : { body }),
});
function handler(verify = async () => principal) {
  return createCollector(f.store, { now: () => now, publisher: { store: f.store, verifyBearer: verify } });
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  const result = await response.json() as { error: { code: string; message: string; requestId: string } };
  assert.equal(result.error.code, code); assert.match(result.error.requestId, UUID);
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message', 'requestId']);
  assert.ok(!JSON.stringify(result).includes('private-detail'));
}

test('server endpoint is closed without a machine verifier and checks authentication before DB or admission', async () => {
  let calls = 0;
  const never = new Proxy(f.store, { get() { calls++; throw Error('private-detail'); } });
  const disabled = createCollector(never, { now: () => now });
  await error(await disabled(request()), 401, 'unauthorized');
  for (const authorization of [null, 'Basic wrong', 'Bearer not-a-credential,other', 'Bearer ' + 'x'.repeat(8192)])
    await error(await createCollector(never, { publisher: { store: never, verifyBearer: async () => { calls++; return principal; } } })
      (request(undefined, { authorization })), 401, 'unauthorized');
  for (const verifyBearer of [async () => null, async () => { throw Error('private-detail'); }, async () => ({ issuer: '', subject: 'x' })])
    await error(await createCollector(never, { publisher: { store: never, verifyBearer } })(request()), 401, 'unauthorized');
  assert.equal(calls, 0); assert.equal(await count('ingest_minute_usage'), 0);
});

test('only explicit project/issuer/subject publisher permission permits ingestion, never an admin owner grant', async () => {
  await f.db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'owner',?)").bind(principal.issuer, principal.subject, now).run();
  const adminOnly = createCollector(f.store, { admin: { store: new D1Queries(f.db), verifyBearer: async () => principal } });
  await error(await adminOnly(request()), 401, 'unauthorized');
  await error(await handler()(request()), 403, 'forbidden');
  assert.equal(await count('ingest_minute_usage'), 0);
  await permit();
  await error(await handler(async () => ({ ...principal, subject: 'other' }))(request()), 403, 'forbidden');
  await error(await handler()(request(undefined, { path: '/v1/projects/unknown/server-batches' })), 403, 'forbidden');
  assert.equal(await count('ingest_minute_usage'), 0);
  const response = await handler()(request(undefined, { headers: { Origin: 'https://evil.invalid' } }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: 1, duplicates: 0 });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(await count('workflow_attempts'), 0); assert.equal(await count('workflow_daily_counts'), 0);
  assert.equal(await f.db.prepare("SELECT source FROM event_receipts").first('source'), 'server');
});

test('server duplicate/conflict handling is atomic and shares daily and minute budgets with browser traffic', async () => {
  await permit(); await f.db.prepare('UPDATE projects SET new_receipts_per_utc_day=1').run();
  const h = handler(); const body = JSON.stringify(input());
  assert.equal((await h(request(body))).status, 200);
  assert.deepEqual(await (await h(request(body))).json(), { accepted: 0, duplicates: 1 });
  const conflict = input(); conflict.events.push({ ...conflict.events[0], eventId: crypto.randomUUID() });
  conflict.events[0].properties.outcome = 'failure';
  await error(await h(request(JSON.stringify(conflict))), 409, 'event_conflict');
  const browser = { schemaVersion: 1, source: 'browser', events: [{ eventId: crypto.randomUUID(), name: 'tool_view',
    occurredAt: new Date(now).toISOString(), properties: { tool: 'loan' } }] };
  const browserResponse = await h(request(JSON.stringify(browser), { path: '/v1/projects/sembom/batches', headers: { Origin: registry.allowedOrigins[0]! } }));
  assert.equal(browserResponse.status, 429);
  assert.equal(await count('event_receipts'), 1);
  assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 1);
  await f.db.prepare('UPDATE projects SET requests_per_minute=4').run();
  const limited = await h(request(body)); await error(limited, 429, 'quota_exceeded');
  assert.equal(limited.headers.get('Retry-After'), '45');
});

test('server HTTP rejects methods, queries, encoding, invalid JSON and source/definition/attempt mismatches', async () => {
  await permit(); const h = handler();
  for (const method of ['GET', 'OPTIONS', 'PUT']) {
    const response = await h(request(undefined, { method })); await error(response, 405, 'invalid_request');
    assert.equal(response.headers.get('Allow'), 'POST');
  }
  await error(await h(request(undefined, { path: '/v1/projects/sembom/server-batches?private-detail=1' })), 400, 'invalid_request');
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json; charset=latin1' },
    { 'Content-Encoding': 'gzip' }])
    await error(await h(request(undefined, { headers })), 415, 'invalid_request');
  await error(await h(request('not JSON')), 400, 'invalid_request');
  await error(await h(request(new Uint8Array([0xc0, 0xaf]))), 400, 'invalid_request');
  await error(await h(request(' '.repeat(16385))), 413, 'invalid_request');
  const browser = input(); browser.source = 'browser';
  await error(await h(request(JSON.stringify(browser))), 400, 'invalid_request');
  for (const mutate of [
    (b: any) => { b.events[0].attempt = { workflowId: 'calculation' }; },
    (b: any) => { b.events[0].name = 'tool_view'; b.events[0].properties = { tool: 'loan' }; },
    (b: any) => { b.events[0].properties.outcome = 'not-registered'; },
    (b: any) => { b.events[0].occurredAt = '2020-01-01T00:00:00Z'; },
  ]) {
    const b = input(); mutate(b); await error(await h(request(JSON.stringify(b))), 422, 'invalid_event');
  }
  const unavailable = input(); unavailable.schemaVersion = 2;
  await error(await h(request(JSON.stringify(unavailable))), 422, 'unknown_schema');
  await f.db.prepare("UPDATE projects SET status='paused'").run();
  await error(await h(request()), 403, 'project_unavailable');
  assert.equal(await count('event_receipts'), 0);
  assert.ok((await f.db.prepare('SELECT request_count AS n FROM ingest_minute_usage').first<number>('n'))! > 10);
});

test('permission revoked after admission but before commit yields 403 without saving an event', async () => {
  await permit();
  const store = new D1Store(f.db);
  const load = store.loadRegistry.bind(store);
  store.loadRegistry = async (...args) => { const result = await load(...args); await f.db.prepare('DELETE FROM project_publishers').run(); return result; };
  const h = createCollector(store, { now: () => now, publisher: { store, verifyBearer: async () => principal } });
  await error(await h(request()), 403, 'forbidden');
  assert.equal(await count('event_receipts'), 0); assert.equal(await count('event_daily_counts'), 0);
  assert.equal(await count('ingest_daily_usage'), 0);
});

test('configured native Worker verifies machine JWTs, isolates audiences and rechecks real D1 permission', async () => {
  const issuer = principal.issuer; const subject = crypto.randomUUID();
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral', alg: 'RS256' }] };
  const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
    contents: `import worker from './apps/collector/src/runtime.ts';
      globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)}); export default worker;` },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    bindings: { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: 'admin-api', OIDC_JWKS_URI: issuer + '/jwks',
      PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: issuer, PUBLISHER_OIDC_AUDIENCE: 'server-events', PUBLISHER_OIDC_JWKS_URI: issuer + '/jwks' },
    d1Databases: { DB: 'server-http-runtime' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB');
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await seed(db);
    await db.prepare('DELETE FROM project_schemas').run();
    await db.prepare("INSERT INTO project_schemas VALUES ('sembom',1,'active',?,?,NULL)")
      .bind(JSON.stringify({ events: [...registry.events, definition], workflows: registry.workflows }), now).run();
    await db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', issuer, subject, 'owner', Date.now()).run();
    const sign = (aud: string | string[], iss = issuer, expiration = '5m') => new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' }).setIssuer(iss).setAudience(aud)
      .setSubject(subject).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
    const b = input(); b.events[0].occurredAt = new Date().toISOString();
    const post = (token: string, path = '/v1/projects/sembom/server-batches') => mf.dispatchFetch('https://collector.example.invalid' + path,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(b) });
    const valid = await sign('server-events'); const admin = await sign('admin-api');
    for (const token of [admin, await sign(['admin-api', 'server-events']), await sign('server-events', 'https://wrong.invalid'),
      await sign('server-events', issuer, '-30s'), valid.slice(0, -8) + 'tampered'])
      assert.equal((await post(token)).status, 401);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM ingest_minute_usage').first('n'), 0);
    assert.equal((await post(valid)).status, 403);
    await db.prepare('INSERT INTO project_publishers (project_id,issuer,subject,created_at) VALUES (?,?,?,?)').bind('sembom', issuer, subject, Date.now()).run();
    assert.deepEqual(await (await post(valid)).json(), { accepted: 1, duplicates: 0 });
    assert.deepEqual(await (await post(valid)).json(), { accepted: 0, duplicates: 1 });
    const adminPath = 'https://collector.example.invalid/v1/projects/sembom/schemas/1';
    assert.equal((await mf.dispatchFetch(adminPath, { headers: { Authorization: 'Bearer ' + valid } })).status, 401);
    assert.equal((await mf.dispatchFetch(adminPath, { headers: { Authorization: 'Bearer ' + admin } })).status, 200);
    assert.equal((await post(valid, '/v1/projects/unknown/server-batches')).status, 403);
    await db.prepare('DELETE FROM project_publishers').run();
    assert.equal((await post(valid)).status, 403);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 1);
  } finally { await mf.dispose(); }
});
