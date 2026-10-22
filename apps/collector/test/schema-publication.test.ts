import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { canonicalJson, parseBatch, prepareBatch, MAX_PUBLICATION_BYTES, schemaDefinitions, sha256 } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '@tallyfin/storage-d1';
import { batch, example, setup, seed, registry, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
const input = () => structuredClone({ expectedLatestVersion: 1, privacyReviewed: true, events: registry.events, workflows: registry.workflows });
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'admin_changes', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
  await fixture.db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
    .bind('sembom', principal.issuer, principal.subject, 'owner', now).run();
});
function handler(store = new D1Queries(fixture.db)) {
  return createCollector(fixture.store, { now: () => now, admin: { store, verifyBearer: async () => principal } });
}
function request(value: unknown = input(), path = '/v1/projects/sembom/schemas/2', method = 'PUT') {
  return new Request(`https://collector.example.invalid${path}`, { method,
    headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(value) }) });
}
const revision = async () => (await fixture.db.prepare('SELECT ingest_revision FROM projects WHERE id=?').bind('sembom').first<{ ingest_revision: number }>())!.ingest_revision;

test('owner validates, publishes and reads source-bound funnels; retries retain definitions and legacy versions', async () => {
  const definitions = schemaDefinitions(example('funnel-registry'));
  const original = await fixture.db.prepare("SELECT definitions_json FROM project_schemas WHERE version=1").first('definitions_json');
  const value = { ...definitions, expectedLatestVersion: 1, privacyReviewed: true };
  const api = handler();
  const validation = await api(request(definitions, '/v1/projects/sembom/schemas/validate', 'POST'));
  assert.equal(validation.status, 200); assert.equal((await validation.json() as any).valid, true);
  const published = await api(request(value)); assert.equal(published.status, 200);
  const meta = await published.json() as any;
  assert.equal(meta.definitionHash, await sha256(canonicalJson(definitions)));
  const savedRevision = await revision();
  assert.deepEqual(await (await api(request(value))).json(), meta); assert.equal(await revision(), savedRevision);
  const read = await api(request(null, '/v1/projects/sembom/schemas/2', 'GET')); assert.equal(read.status, 200);
  assert.deepEqual((await read.json() as any).funnels, definitions.funnels);
  assert.deepEqual((await fixture.store.loadRegistry('sembom', 2))!.funnels, definitions.funnels);
  assert.equal(await fixture.db.prepare("SELECT definitions_json FROM project_schemas WHERE version=1").first('definitions_json'), original);
  const changed = structuredClone(value); changed.funnels![0]!.label = 'Changed funnel';
  assert.equal((await api(request(changed))).status, 409);
  const invalid = structuredClone(definitions); invalid.funnels![0]!.steps[2]!.source = 'browser';
  assert.deepEqual(await (await api(request(invalid, '/v1/projects/sembom/schemas/validate', 'POST'))).json(),
    { valid: false, issues: [{ path: '/funnels/0/steps/2', code: 'invalid_reference' }], privacyReviewRequired: true });
  assert.equal((await api(request({ ...invalid, expectedLatestVersion: 2, privacyReviewed: true }, '/v1/projects/sembom/schemas/3'))).status, 400);
  assert.equal((await api(request({ ...definitions, funnels: null }, '/v1/projects/sembom/schemas/validate', 'POST'))).status, 400);
  await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
  assert.equal((await api(request(null, '/v1/projects/sembom/schemas/2', 'GET'))).status, 200);
  assert.equal((await api(request(value))).status, 403);
});
test('publication preserves settings and old definitions/counts, increments revision once, and becomes collectable', async () => {
  await fixture.store.commit(await prepareBatch(parseBatch(JSON.stringify(batch())), registry, now), registry);
  const previous = await fixture.db.prepare('SELECT * FROM projects').first<any>();
  const counts = (await fixture.db.prepare('SELECT * FROM event_daily_counts').all()).results;
  const response = await handler()(request()); assert.equal(response.status, 200);
  const published = await response.json() as any;
  assert.equal(published.schemaVersion, 2); assert.equal(published.schemaStatus, 'active'); assert.match(published.definitionHash, /^[a-f0-9]{64}$/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.deepEqual(await fixture.db.prepare('SELECT * FROM projects').first(), { ...previous, ingest_revision: previous.ingest_revision + 1 });
  assert.deepEqual((await fixture.db.prepare('SELECT * FROM event_daily_counts').all()).results, counts);
  assert.deepEqual((await fixture.store.loadRegistry('sembom', 1))!.events, registry.events);
  const next = (await fixture.store.loadRegistry('sembom', 2))!;
  const events = batch(); events.schemaVersion = 2; const attemptId = crypto.randomUUID();
  events.events.forEach((e: any) => { e.eventId = crypto.randomUUID(); if (e.attempt) e.attempt.attemptId = attemptId; });
  assert.equal((await fixture.store.commit(await prepareBatch(parseBatch(JSON.stringify(events)), next, now), next)).accepted, events.events.length);
});
test('same-content retry succeeds after response loss/newer versions without another write; replacement conflicts', async () => {
  const first = await (await handler()(request())).json(); const afterFirst = await revision();
  // Reorder JSON object keys while preserving definition contents.
  const reordered = input(); reordered.events[0]!.properties.tool = Object.fromEntries(Object.entries(reordered.events[0]!.properties.tool!).reverse()) as any;
  assert.deepEqual(await (await handler()(request(reordered))).json(), first); assert.equal(await revision(), afterFirst);
  assert.equal((await handler()(request({ ...input(), expectedLatestVersion: 2 }, '/v1/projects/sembom/schemas/3'))).status, 200);
  const latestRevision = await revision(); assert.deepEqual(await (await handler()(request())).json(), first); assert.equal(await revision(), latestRevision);
  const changed = input(); changed.events[0]!.label = 'Different definition';
  assert.equal((await handler()(request(changed))).status, 409); assert.equal(await revision(), latestRevision);
  assert.equal((await handler()(request(input(), '/v1/projects/sembom/schemas/4'))).status, 409);
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE version=2").run();
  const retired = await handler()(request()); assert.equal(retired.status, 200);
  assert.equal((await retired.json() as any).schemaStatus, 'retired'); assert.equal(await revision(), latestRevision);
});
test('concurrent different versions share the latest-version guard and identical requests are idempotent', async () => {
  const results = await Promise.all([handler()(request()), handler()(request(input(), '/v1/projects/sembom/schemas/3'))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(await revision(), 1);
  await fixture.db.prepare('DELETE FROM project_schemas WHERE version > 1').run();
  const start = await revision();
  assert.deepEqual((await Promise.all([handler()(request()), handler()(request())])).map(r => r.status), [200, 200]);
  assert.equal(await revision(), start + 1);
});
test('owner revoked between preliminary access and atomic publication cannot write', async () => {
  let calls = 0;
  const proxy: SqlDatabase = { prepare: fixture.db.prepare.bind(fixture.db), async batch<T>(statements: SqlStatement[]) {
    if (++calls === 2) await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
    return fixture.db.batch<T>(statements);
  } };
  assert.equal((await handler(new D1Queries(proxy))(request())).status, 403);
  assert.equal((await fixture.db.prepare('SELECT * FROM project_schemas').all()).results.length, 1); assert.equal(await revision(), 0);
});
test('reader/missing/foreign grants deny publication; malformed definitions and unreviewed privacy never publish', async () => {
  assert.equal((await createCollector(fixture.store)(request())).status, 401);
  for (const value of [{ ...input(), privacyReviewed: false }, { ...input(), expectedLatestVersion: 0 }, { ...input(), events: [] },
    { ...input(), schemaStatus: 'retired' }, { ...input(), project: registry.project }, { ...input(), workflows: null }])
    assert.equal((await handler()(request(value))).status, 400);
  assert.equal((await handler()(request(input(), '/v1/projects/sembom/schemas/2147483648'))).status, 400);
  await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
  assert.equal((await handler()(request())).status, 403);
  assert.equal((await handler()(request(input(), '/v1/projects/foreign/schemas/2'))).status, 403);
  assert.equal((await fixture.db.prepare('SELECT * FROM project_schemas').all()).results.length, 1);
});
test('schema listing is bounded, newest first, rechecks grants and keeps retired/paused definitions visible', async () => {
  await handler()(request()); await handler()(request({ ...input(), expectedLatestVersion: 2 }, '/v1/projects/sembom/schemas/4'));
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE version=1").run();
  await fixture.db.prepare("UPDATE projects SET status='paused'").run();
  await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
  const get = (query = '') => handler()(request(null, `/v1/projects/sembom/schemas${query}`, 'GET'));
  const first = await (await get('?limit=2')).json() as any;
  assert.equal(first.latestVersion, 4); assert.deepEqual(first.data.map((s: any) => s.schemaVersion), [4, 2]); assert.equal(first.page.beforeVersion, 2);
  assert.equal(first.latestActiveVersion, 4);
  const next = await (await get('?limit=2&beforeVersion=2')).json() as any;
  assert.deepEqual(next.data.map((s: any) => s.schemaVersion), [1]); assert.equal(next.data[0].schemaStatus, 'retired'); assert.equal(next.page.beforeVersion, null);
  assert.equal(next.latestActiveVersion, 4);
  await fixture.db.prepare("UPDATE project_schemas SET status='retired' WHERE version=4").run();
  const active = await (await get('?limit=1')).json() as any;
  assert.equal(active.latestActiveVersion, 2); assert.equal(active.latestVersion, 4);
  await fixture.db.prepare("UPDATE project_schemas SET status='retired'").run();
  assert.equal((await (await get()).json() as any).latestActiveVersion, null);
  for (const query of ['?limit=101', '?beforeVersion=0', '?limit=2&limit=2', '?private=1']) assert.equal((await get(query)).status, 400);
  await fixture.db.prepare('DELETE FROM project_grants').run(); assert.equal((await get()).status, 403);
});
test('empty schema project can publish its first version; revision failure rolls back insertion', async () => {
  await fixture.db.prepare('DELETE FROM project_schemas').run();
  const list = await handler()(request(null, '/v1/projects/sembom/schemas', 'GET'));
  const empty = await list.json() as any;
  assert.equal(empty.latestVersion, null); assert.equal(empty.latestActiveVersion, null);
  assert.equal((await handler()(request({ ...input(), expectedLatestVersion: null }, '/v1/projects/sembom/schemas/1'))).status, 200);
  await fixture.db.prepare('UPDATE projects SET ingest_revision=9007199254740991').run();
  assert.equal((await handler()(request())).status, 503);
  assert.equal((await fixture.db.prepare('SELECT * FROM project_schemas WHERE version=2').all()).results.length, 0);
});
test('publication enforces transport limits and method declarations without leaking storage errors', async () => {
  const oversized = request(' '.repeat(MAX_PUBLICATION_BYTES + 1)); assert.equal((await handler()(oversized)).status, 413);
  const denied = await handler()(request(null, undefined, 'POST')); assert.equal(denied.status, 405); assert.equal(denied.headers.get('Allow'), 'GET, PUT');
  assert.equal((await handler()(request(input(), '/v1/projects/sembom/schemas/2?extra=1'))).status, 400);
});
