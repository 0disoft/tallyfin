import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { CollectionError } from '@tallyfin/core';
import type { AdminPrincipal } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlStatement } from '@tallyfin/storage-d1';
import { setup } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';
import { createWorker } from '../src/index.ts';
import { checkAdministratorStorageRead } from '../src/readiness.ts';
import type { AdministratorAccess } from '../src/admin.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'test-admin' };
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
// A non-credential sentinel exercises the trusted verifier port; runtime.test.ts uses ephemeral signed JWTs.
function request(path = '/v1/health', method = 'GET', authorization: string | null = 'Bearer not-a-credential') {
  return new Request(`https://collector.example.invalid${path}`, { method,
    headers: { ...(authorization ? { Authorization: authorization } : {}), Origin: 'https://example.invalid' } });
}
function handler(checkReadiness?: AdministratorAccess['checkReadiness'], verifyBearer: AdministratorAccess['verifyBearer'] = async () => principal) {
  return createCollector(fixture.store, { admin: { store: new D1Queries(fixture.db), verifyBearer,
    ...(checkReadiness ? { checkReadiness } : {}) } });
}
async function fixedFailure(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const body = await response.json() as { error: { code: string; message: string; requestId: string } };
  assert.equal(body.error.code, code);
  assert.ok(!JSON.stringify(body).includes('private-marker'));
}

test('native health checks storage with no grant while returning no identity or project rows', async () => {
  assert.equal(await fixture.db.prepare('SELECT count(*) AS n FROM project_grants').first('n'), 0);
  const before = await fixture.db.prepare('SELECT ingest_revision FROM projects').all();
  const response = await createWorker(async () => principal).fetch(request(), { DB: fixture.db });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { status: 'ok', scope: 'administrator_storage_read' });
  assert.ok(Buffer.byteLength(text) < 128);
  assert.deepEqual((await fixture.db.prepare('SELECT ingest_revision FROM projects').all()).results, before.results);
  for (const table of ['event_receipts', 'ingest_minute_usage', 'ingest_daily_usage', 'admin_changes'])
    assert.equal(await fixture.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'), 0);
});

test('authentication gates every method and query before any probe or body read', async () => {
  let probes = 0, bodyReads = 0;
  const probe = async () => { probes++; };
  for (const authorization of [null, 'Basic not-a-credential', 'Bearer two values', 'Bearer ' + 'x'.repeat(8192)]) {
    const response = await handler(probe)(request('/v1/health?private-marker=1', 'POST', authorization));
    await fixedFailure(response, 401, 'unauthorized');
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  }
  for (const verifier of [async () => null, async () => { throw Error('private-marker'); },
    async (): Promise<AdminPrincipal> => ({ issuer: principal.issuer, subject: 'invalid\nsubject' })])
    await fixedFailure(await handler(probe, verifier)(request()), 401, 'unauthorized');
  await fixedFailure(await createCollector(fixture.store)(request()), 401, 'unauthorized');
  for (const method of ['HEAD', 'POST', 'OPTIONS', 'PUT', 'DELETE']) {
    const input = request('/v1/health', method);
    Object.defineProperty(input, 'body', { get() { bodyReads++; throw Error('private-marker'); } });
    const response = await handler(probe)(input);
    await fixedFailure(response, 405, 'invalid_request'); assert.equal(response.headers.get('Allow'), 'GET');
  }
  for (const suffix of ['?limit=1', '?x=1&x=2', '?subject=private-marker', '?x=' + 'a'.repeat(513)])
    await fixedFailure(await handler(probe)(request('/v1/health' + suffix)), 400, 'invalid_request');
  assert.equal(probes, 0); assert.equal(bodyReads, 0);
});

test('probe is awaited once and host failures are fixed 503 even when their underlying error is typed', async () => {
  let release!: () => void, probes = 0, completed = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = handler(async () => { probes++; await gate; })(request()).then(response => { completed = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes, 1); assert.equal(completed, false);
  release(); assert.equal((await pending).status, 200);
  for (const probe of [undefined, async () => { throw Error('private-marker'); },
    async () => { throw new CollectionError('forbidden', 403); }]) {
    const response = await handler(probe)(request());
    await fixedFailure(response, 503, 'storage_unavailable'); assert.equal(response.headers.get('Retry-After'), '1');
  }
});

test('storage probe reads at most one constant row per control-plane table in a single batch', async () => {
  const queries: string[] = []; let batches = 0;
  await checkAdministratorStorageRead({
    prepare(sql) { queries.push(sql); return fixture.db.prepare(sql); },
    async batch<T>(statements: SqlStatement[]) { batches++; return fixture.db.batch<T>(statements); },
  });
  assert.equal(batches, 1); assert.equal(queries.length, 2);
  assert.ok(queries.every(sql => /^SELECT 1 AS available FROM (projects|project_grants) LIMIT 1$/.test(sql)));
});

test('empty tables pass and a missing control-plane table fails without leaking DB details', async () => {
  await fixture.db.prepare('DELETE FROM project_schemas').run();
  await fixture.db.prepare('DELETE FROM projects').run();
  assert.equal((await createWorker(async () => principal).fetch(request(), { DB: fixture.db })).status, 200);
  await fixture.db.prepare('ALTER TABLE project_grants RENAME TO private_missing_grants').run();
  const response = await createWorker(async () => principal).fetch(request(), { DB: fixture.db });
  await fixedFailure(response, 503, 'storage_unavailable');
  assert.equal(response.headers.get('Retry-After'), '1');
  await fixture.db.prepare('ALTER TABLE private_missing_grants RENAME TO project_grants').run();
});
