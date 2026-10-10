import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { IdentityReader, parseAdminIdentity, identityJson } from './admin-identity.ts';

const identity = { issuer: 'https://identity.example.invalid', subject: 'test-administrator' };
test('identity response and copying are closed, bounded and contain no credentials or inferred role', () => {
  assert.deepEqual(JSON.parse(identityJson(parseAdminIdentity(identity))), identity);
  for (const value of [null, [], { ...identity, token: 'not-accepted' }, { ...identity, role: 'owner' },
    { ...identity, issuer: 'http://identity.example.invalid' }, { ...identity, subject: '' },
    { ...identity, subject: 'x'.repeat(513) }, { ...identity, subject: 'a\nb' }]) assert.throws(() => parseAdminIdentity(value));
});
test('client uses the protected same-origin identity GET and does not copy the bearer into results', async () => {
  let request;
  const client = new ApiClient({ token: 'unit-port-only', fetchImpl: async (url, init) => {
    request = { url, init }; return { ok: true, status: 200, json: async () => identity };
  } });
  const signal = new AbortController().signal; assert.deepEqual(await client.getIdentity({ signal }), identity);
  assert.equal(request.url, '/v1/identity'); assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.cache, 'no-store'); assert.equal(request.init.referrerPolicy, 'no-referrer');
  assert.equal(request.init.headers.Authorization, 'Bearer unit-port-only');
  assert.ok(!identityJson(identity).includes('unit-port-only')); client.destroy();
});
test('identity reader is opt-in, suppresses concurrent reads, clears on errors and can retry', async () => {
  let calls = 0, resolve;
  const client = { getIdentity: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const reader = new IdentityReader(client, () => {}); assert.equal(calls, 0);
  const first = reader.open(); await reader.open(); assert.equal(calls, 1); assert.equal(reader.state.identity, null);
  resolve(identity); await first; assert.equal(reader.state.phase, 'ready');
  client.getIdentity = async () => { throw new ApiError('unauthorized', '관리자 인증이 필요해요.'); };
  await reader.open(); assert.equal(reader.state.phase, 'error'); assert.equal(reader.state.identity, null);
  client.getIdentity = async () => identity; await reader.open(); assert.equal(reader.state.phase, 'ready'); reader.destroy();
});
test('closing and disposal abort requests and late replies cannot restore identities', async () => {
  for (const action of ['close', 'destroy']) {
    let signal, resolve, changes = 0;
    const reader = new IdentityReader({ getIdentity: options => { signal = options.signal; return new Promise(r => { resolve = r; }); } }, () => { changes++; });
    const running = reader.open(); reader[action](); const count = changes;
    assert.equal(signal.aborted, true); assert.equal(reader.state.phase, 'idle');
    resolve(identity); await running; assert.equal(reader.state.identity, null); assert.equal(changes, count);
    if (action === 'destroy') { await reader.open(); assert.equal(changes, count); }
  }
});
