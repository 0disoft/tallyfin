import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { CollectionError, parseBatch, prepareBatch } from '@tallyfin/core';
import type { AdminPrincipal, ProjectSettings } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '../../../packages/storage-d1/src/sql.ts';
import { batch, setup, seed, registry, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal: AdminPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage',
    'workflow_attempts', 'event_receipts', 'admin_changes', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
  await fixture.db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
    .bind('sembom', principal.issuer, principal.subject, 'owner', now).run();
});
function handler(store = new D1Queries(fixture.db)) {
  return createCollector(fixture.store, { now: () => now, admin: { store, verifyBearer: async () => principal } });
}
function request(value: unknown, path = '/v1/projects/sembom', method = 'PATCH') {
  return new Request(`https://collector.example.invalid${path}`, { method,
    headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(value) }) });
}
async function settings(): Promise<ProjectSettings> {
  const response = await handler()(request(null, undefined, 'GET'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return response.json() as Promise<ProjectSettings>;
}
async function patch(value: unknown, status = 200) {
  const response = await handler()(request(value));
  assert.equal(response.status, status); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json() as Promise<any>;
}
// Inject a real database change between the initial read and the atomic write batch.
function interleave(action: () => Promise<unknown>): D1Queries {
  let calls = 0;
  const proxy: SqlDatabase = { prepare: fixture.db.prepare.bind(fixture.db), async batch<T>(statements: SqlStatement[]) {
    if (++calls === 2) await action();
    return fixture.db.batch<T>(statements);
  } };
  return new D1Queries(proxy);
}
test('owner updates all settings, preserves identity/schema, and partial limits preserve omitted values', async () => {
  const original = await settings();
  assert.equal(original.canEdit, true);
  const result = await patch({ expectedSettingsHash: original.settingsHash, name: 'Renamed project', status: 'paused',
    allowedOrigins: ['https://new.example.invalid'], limits: { requestsPerMinute: 50 } });
  assert.equal(result.project.name, 'Renamed project'); assert.equal(result.project.status, 'paused');
  assert.equal(result.project.id, 'sembom'); assert.equal(result.project.timeZone, original.project.timeZone);
  assert.deepEqual(result.limits, { requestsPerMinute: 50, newReceiptsPerUtcDay: original.limits.newReceiptsPerUtcDay });
  assert.deepEqual(await settings(), result); assert.notEqual(result.settingsHash, original.settingsHash);
  const snapshot = await fixture.store.loadRegistry('sembom', 1);
  assert.deepEqual(snapshot?.events, registry.events); assert.deepEqual(snapshot?.allowedOrigins, result.allowedOrigins);
  await patch({ expectedSettingsHash: result.settingsHash, status: 'active', limits: { newReceiptsPerUtcDay: 15 } });
  assert.deepEqual((await settings()).limits, { requestsPerMinute: 50, newReceiptsPerUtcDay: 15 });
});
test('reader can read but cannot write; revoked, foreign and missing project grants deny access', async () => {
  const { settingsHash } = await settings();
  await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
  const readOnly = await settings(); assert.equal(readOnly.canEdit, false); assert.equal(readOnly.settingsHash, settingsHash);
  assert.equal((await patch({ expectedSettingsHash: settingsHash, name: 'denied' }, 403)).error.code, 'forbidden');
  await fixture.db.prepare('DELETE FROM project_grants').run();
  assert.equal((await handler()(request(null, undefined, 'GET'))).status, 403);
  await patch({ expectedSettingsHash: settingsHash, name: 'denied' }, 403);
  await fixture.db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
    .bind('sembom', 'https://other.example.invalid', principal.subject, 'owner', now).run();
  await patch({ expectedSettingsHash: settingsHash, name: 'denied' }, 403);
  assert.equal((await handler()(request({ expectedSettingsHash: settingsHash, name: 'denied' }, '/v1/projects/absent'))).status, 403);
});
test('write authentication fails closed without verifier or with invalid identity', async () => {
  for (const verifier of [undefined, async () => null, async () => ({ issuer: '', subject: 'x' }), async () => { throw Error('private detail'); }]) {
    const response = await createCollector(fixture.store, verifier ? { admin: { store: new D1Queries(fixture.db), verifyBearer: verifier } } : {})(request({ name: 'denied' }));
    assert.equal(response.status, 401); assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
    assert.ok(!(await response.text()).includes('private detail'));
  }
});
test('closed bounded update rejects invalid values, unknown keys and ambiguous origins without changes', async () => {
  const original = await settings();
  const invalid = [{}, { name: '' }, { name: 'x'.repeat(81) }, { name: null }, { status: 'retired' }, { timeZone: 'UTC' },
    { id: 'other' }, { events: [] }, { allowedOrigins: [] }, { allowedOrigins: Array(17).fill('https://example.invalid') },
    { allowedOrigins: ['https://example.invalid', 'https://example.invalid'] }, { allowedOrigins: ['https://*.invalid'] },
    { allowedOrigins: ['https://example.invalid/'] }, { allowedOrigins: ['https://user@example.invalid'] },
    { allowedOrigins: ['http://localhost:5173'] }, { allowedOrigins: ['http://remote.example.invalid'] },
    { allowedOrigins: ['null'] }, { allowedOrigins: [1] }, { limits: {} }, { limits: { private: 1 } },
    { limits: { requestsPerMinute: 0 } }, { limits: { requestsPerMinute: 601 } }, { limits: { requestsPerMinute: 1.5 } },
    { limits: { newReceiptsPerUtcDay: 1_000_001 } }, { limits: null }];
  for (const value of invalid) await patch({ expectedSettingsHash: original.settingsHash, ...value }, 400);
  for (const value of [{ name: 'missing hash' }, { expectedSettingsHash: 'bad', name: 'bad hash' }, null, []]) await patch(value, 400);
  assert.deepEqual(await settings(), original);
});
test('body size, content type, malformed JSON, parameters and route methods remain bounded', async () => {
  for (const [body, type, status] of [['{', 'application/json', 400], ['x'.repeat(16 * 1024 + 1), 'application/json', 413],
    ['{}', 'application/x-www-form-urlencoded', 415]] as const) {
    const response = await handler()(new Request('https://collector.example.invalid/v1/projects/sembom', {
      method: 'PATCH', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': type }, body }));
    assert.equal(response.status, status);
  }
  const { settingsHash } = await settings();
  assert.equal((await handler()(request({ expectedSettingsHash: settingsHash, name: 'x' }, '/v1/projects/sembom?extra=1'))).status, 400);
  const denied = await handler()(request({}, undefined, 'POST'));
  assert.equal(denied.status, 405); assert.equal(denied.headers.get('Allow'), 'GET, PATCH');
  const unsupported = await handler()(request({}, '/v1/projects/sembom/schemas/1'));
  assert.equal(unsupported.status, 405); assert.equal(unsupported.headers.get('Allow'), 'GET, PUT');
});
test('stale hash returns 409; ingestion revisions alone do not prevent settings updates', async () => {
  const original = await settings();
  const store = interleave(() => fixture.store.commit(batchPrepared, registry));
  const batchPrepared = await prepareBatch(parseBatch(JSON.stringify(batch())), registry, now);
  const response = await handler(store)(request({ expectedSettingsHash: original.settingsHash, name: 'after ingest' }));
  assert.equal(response.status, 200);
  const changed = await settings();
  assert.equal((await patch({ expectedSettingsHash: original.settingsHash, status: 'paused' }, 409)).error.code, 'settings_conflict');
  assert.deepEqual(await settings(), changed);
});
test('concurrent configuration change cannot be overwritten; owner revocation/demotion blocks the write', async () => {
  const { settingsHash } = await settings();
  const concurrent = interleave(() => fixture.db.prepare("UPDATE projects SET name='other edit'").run());
  const response = await handler(concurrent)(request({ expectedSettingsHash: settingsHash, name: 'my edit' }));
  assert.equal(response.status, 409); assert.equal((await settings()).project.name, 'other edit');
  const current = await settings();
  const revoked = interleave(() => fixture.db.prepare("UPDATE project_grants SET role='reader'").run());
  assert.equal((await handler(revoked)(request({ expectedSettingsHash: current.settingsHash, name: 'denied' }))).status, 403);
  assert.deepEqual(await settings(), { ...current, canEdit: false });
});
test('paused/origin/limit changes affect ingestion and invalidate an already prepared registry', async () => {
  const oldRegistry = await fixture.store.loadRegistry('sembom', 1);
  const prepared = await prepareBatch(parseBatch(JSON.stringify(batch())), oldRegistry!, now);
  const current = await settings();
  await patch({ expectedSettingsHash: current.settingsHash, status: 'paused' });
  await assert.rejects(fixture.store.commit(prepared, oldRegistry!), (e: unknown) => e instanceof CollectionError && e.code === 'project_unavailable');
  const collect = (origin: string) => handler()(new Request('https://collector.example.invalid/v1/projects/sembom/batches', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(batch()) }));
  assert.equal((await (await collect(registry.allowedOrigins[0]!)).json() as any).error.code, 'project_unavailable');
  await patch({ expectedSettingsHash: (await settings()).settingsHash, status: 'active', allowedOrigins: ['https://new.example.invalid'],
    limits: { requestsPerMinute: 600, newReceiptsPerUtcDay: 1 } });
  assert.equal((await (await collect(registry.allowedOrigins[0]!)).json() as any).error.code, 'origin_denied');
  assert.equal((await (await collect('https://new.example.invalid')).json() as any).error.code, 'quota_exceeded');
  await patch({ expectedSettingsHash: (await settings()).settingsHash, limits: { requestsPerMinute: 1 } });
  assert.equal((await (await collect('https://new.example.invalid')).json() as any).error.code, 'quota_exceeded');
  const loaded = await fixture.store.loadProject('sembom');
  assert.deepEqual(loaded?.allowedOrigins, ['https://new.example.invalid']); assert.equal(loaded?.limits.requestsPerMinute, 1);
});
test('loopback HTTP origins require explicit adapter configuration', async () => {
  const current = await settings();
  const local = new D1Queries(fixture.db, { allowLocalHttp: true });
  const response = await handler(local)(request({ expectedSettingsHash: current.settingsHash, allowedOrigins: ['http://127.0.0.1:5173'] }));
  assert.equal(response.status, 200);
  assert.deepEqual((await local.settings(principal, 'sembom')).allowedOrigins, ['http://127.0.0.1:5173']);
  assert.equal((await handler(local)(request({ expectedSettingsHash: (await local.settings(principal, 'sembom')).settingsHash,
    allowedOrigins: ['http://remote.example.invalid'] }))).status, 400);
});
