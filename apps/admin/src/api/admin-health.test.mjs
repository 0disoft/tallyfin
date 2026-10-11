import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { HealthReader } from './admin-health.ts';
import { parseAdminHealth } from './admin-health-contract.ts';

const health = { status: 'ok', scope: 'administrator_storage_read' };
test('health validation accepts only the declared read scope and rejects extra identity and credential fields', () => {
  assert.deepEqual(parseAdminHealth(health), health); assert.ok(Object.isFrozen(parseAdminHealth(health)));
  for (const value of [null, [], {}, { ...health, scope: 'whole_service' }, { status: 'ok' },
    { ...health, status: 'ready' }, { ...health, issuer: 'private-marker' }, { ...health, token: 'private-marker' }])
    assert.throws(() => parseAdminHealth(value));
});

test('client sends the authenticated same-origin GET without exposing a bearer in the health result', async () => {
  let request;
  const client = new ApiClient({ token: 'unit-port-only', fetchImpl: async (url, init) => {
    request = { url, init }; return { ok: true, status: 200, json: async () => health };
  } });
  const signal = new AbortController().signal;
  assert.deepEqual(await client.getHealth({ signal }), health);
  assert.equal(request.url, '/v1/health'); assert.equal(request.init.method, 'GET');
  assert.equal(request.init.credentials, 'omit'); assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.referrerPolicy, 'no-referrer'); assert.equal(request.init.headers.Authorization, 'Bearer unit-port-only');
  assert.equal(request.init.body, undefined); client.destroy();
});

test('reader is manual, suppresses concurrent reads and clears a successful check before retry or error', async () => {
  let calls = 0, resolve;
  const client = { getHealth: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const reader = new HealthReader(client, () => {});
  assert.equal(calls, 0); assert.equal(reader.state.checkedAt, null);
  const pending = reader.open(); await reader.open(); assert.equal(calls, 1);
  resolve(health); await pending; assert.equal(reader.state.phase, 'ready');
  assert.ok(Number.isFinite(Date.parse(reader.state.checkedAt)));
  client.getHealth = async () => { assert.equal(reader.state.checkedAt, null); throw new ApiError('storage_unavailable', 'private-marker'); };
  await reader.open(); assert.equal(reader.state.phase, 'error'); assert.equal(reader.state.checkedAt, null);
  assert.ok(!reader.state.message.includes('private-marker'));
  client.getHealth = async () => health; await reader.open(); assert.equal(reader.state.phase, 'ready'); reader.destroy();
});

test('close, disposal and connection replacement abort checks and discard late success or failure', async () => {
  for (const action of ['close', 'destroy']) for (const rejectLate of [false, true]) {
    let signal, resolve, reject, changes = 0;
    const reader = new HealthReader({ getHealth: options => { signal = options.signal; return new Promise((r, j) => { resolve = r; reject = j; }); } }, () => { changes++; });
    const pending = reader.open(); reader[action](); const count = changes;
    assert.equal(signal.aborted, true); assert.equal(reader.state.phase, 'idle');
    if (rejectLate) reject(Error('private-marker')); else resolve(health);
    await pending; assert.equal(changes, count); assert.equal(reader.state.checkedAt, null);
    if (action === 'destroy') { await reader.open(); assert.equal(changes, count); }
  }
});

test('deadline ends loading, aborts a stalled request and protects a later retry from its late result', async () => {
  let resolveOld, signalOld;
  const client = { getHealth: options => { signalOld = options.signal; return new Promise(r => { resolveOld = r; }); } };
  let timeout;
  const timedOut = new Promise(r => { timeout = r; });
  const reader = new HealthReader(client, state => { if (state.phase === 'error') timeout(); }, 15);
  const first = reader.open(); await timedOut;
  assert.equal(signalOld.aborted, true); assert.equal(reader.state.checkedAt, null);
  assert.equal(reader.state.phase, 'error');
  client.getHealth = async () => health; await reader.open(); const checkedAt = reader.state.checkedAt;
  resolveOld(health); await first; assert.equal(reader.state.phase, 'ready'); assert.equal(reader.state.checkedAt, checkedAt);
  reader.destroy();
});
