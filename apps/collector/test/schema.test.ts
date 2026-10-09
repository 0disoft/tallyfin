import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { MAX_SCHEMA_BYTES } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import { setup, seed, registry, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
const path = '/v1/projects/sembom/schemas/validate';
const draft = () => structuredClone({ events: registry.events, workflows: registry.workflows });
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  await fixture.db.batch(['project_grants', 'project_schemas', 'projects'].map(table => fixture.db.prepare(`DELETE FROM ${table}`)));
  await seed(fixture.db);
  await fixture.db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
    .bind('sembom', principal.issuer, principal.subject, 'owner', now).run();
});
function handler(store = new D1Queries(fixture.db)) {
  return createCollector(fixture.store, { now: () => now, admin: { store, verifyBearer: async () => principal } });
}
function request(body: string = JSON.stringify(draft()), target = path, method = 'POST', headers: Record<string, string> = {}) {
  return new Request(`https://collector.example.invalid${target}`, { method,
    headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body }) });
}
test('owner validates a draft without changing any project/schema/usage and can still read the published schema', async () => {
  const before = (await fixture.db.prepare('SELECT * FROM projects').all()).results;
  const response = await handler()(request()); assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  assert.deepEqual(await response.json(), { valid: true, issues: [], privacyReviewRequired: true });
  assert.deepEqual((await fixture.db.prepare('SELECT * FROM projects').all()).results, before);
  assert.equal((await fixture.db.prepare('SELECT * FROM project_schemas').all()).results.length, 1);
  for (const table of ['ingest_minute_usage', 'ingest_daily_usage'])
    assert.equal((await fixture.db.prepare(`SELECT * FROM ${table}`).all()).results.length, 0);
  const published = await handler()(request('', '/v1/projects/sembom/schemas/1', 'GET'));
  assert.equal(published.status, 200); assert.deepEqual((await published.json() as any).events, registry.events);
  await fixture.db.prepare("UPDATE projects SET status='paused'").run();
  assert.equal((await handler()(request())).status, 200);
});
test('semantic errors return a bounded report with no draft values or raw exceptions', async () => {
  const input = draft(); input.workflows[0]!.successEvent = 'unregistered';
  const response = await handler()(request(JSON.stringify(input))); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { valid: false, issues: [{ path: '/workflows/0/successEvent', code: 'invalid_reference' }], privacyReviewRequired: true });
  input.events[0]!.label = ''; input.events[0]!.properties.tool = { type: 'enum', values: ['private free text'], required: true, purpose: 'private purpose' };
  const text = await (await handler()(request(JSON.stringify(input)))).text();
  assert.ok(!text.includes('private')); assert.ok(!text.includes('unregistered'));
});
test('authentication and owner authorization run before reading the draft', async () => {
  assert.equal((await createCollector(fixture.store)(request())).status, 401);
  assert.equal((await handler()(request('{', path, 'POST', { Authorization: '' }))).status, 401);
  await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
  assert.equal((await handler()(request('{'))).status, 403);
  assert.equal((await handler()(request('', '/v1/projects/sembom/schemas/1', 'GET'))).status, 200);
  await fixture.db.prepare('DELETE FROM project_grants').run();
  assert.equal((await handler()(request())).status, 403);
  assert.equal((await handler()(request(undefined, '/v1/projects/foreign/schemas/validate'))).status, 403);
});
test('revocation at the granted snapshot denies validation and storage failures stay 503', async () => {
  const revoked = new D1Queries({ prepare: fixture.db.prepare.bind(fixture.db), async batch<T>(statements: any[]) {
    await fixture.db.prepare('DELETE FROM project_grants').run(); return fixture.db.batch<T>(statements);
  } });
  assert.equal((await handler(revoked)(request())).status, 403);
  const unavailable = new D1Queries({ prepare: fixture.db.prepare.bind(fixture.db), batch: async () => [] });
  assert.equal((await handler(unavailable)(request())).status, 503);
});
test('closed envelope, unsupported methods/media and query parameters are rejected', async () => {
  for (const value of [null, [], {}, { ...draft(), schemaVersion: 2 }, { ...draft(), project: registry.project }, { events: null, workflows: [] }])
    assert.equal((await handler()(request(JSON.stringify(value)))).status, 400);
  assert.equal((await handler()(request('{'))).status, 400);
  assert.equal((await handler()(request(undefined, `${path}?extra=1`))).status, 400);
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const response = await handler()(request('', path, method)); assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'POST');
  }
  for (const headers of [{ 'Content-Type': 'application/octet-stream' }, { 'Content-Encoding': 'gzip' }])
    assert.equal((await handler()(request(undefined, path, 'POST', headers))).status, 415);
});
test('schema bodies accept the existing 32KiB definition budget and enforce byte limits with/without Content-Length', async () => {
  const body = JSON.stringify(draft()).padEnd(20 * 1024, ' ');
  assert.equal((await handler()(request(body))).status, 200);
  for (const headers of [{}, { 'Content-Length': String(MAX_SCHEMA_BYTES + 1) }])
    assert.equal((await handler()(request(' '.repeat(MAX_SCHEMA_BYTES + 1), path, 'POST', headers))).status, 413);
  assert.equal((await handler()(request('가'.repeat(12 * 1024)))).status, 413);
});
