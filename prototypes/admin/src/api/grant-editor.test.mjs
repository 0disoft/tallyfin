import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from './client.ts';
import { GrantEditor } from './grant-editor.ts';
import { parseGrantMutationResult } from './grants-contract.ts';

const identity = { issuer: 'https://identity.example.invalid', subject: 'test-reader' };
const change = { ...identity, role: 'reader', expectedRole: null };
const result = (input = change, extra = {}) => ({ projectId: 'sembom', issuer: input.issuer, subject: input.subject,
  role: input.role, createdAt: input.role === null ? null : '2026-10-11T00:00:00.000Z', canManage: true, changed: true, ...extra });
const response = value => ({ ok: true, status: 200, json: async () => value });
const failure = (status, code) => ({ ok: false, status, json: async () => ({ error: { code, message: 'private server details' } }) });
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('grant mutation response is closed and keeps absence, creation time and roles consistent', () => {
  assert.deepEqual(parseGrantMutationResult(result()), result());
  assert.deepEqual(parseGrantMutationResult(result({ ...change, role: null })), result({ ...change, role: null }));
  for (const extra of [{ role: null }, { createdAt: null }, { role: 'admin' }, { canManage: 1 }, { changed: undefined },
    { projectId: 'BAD' }, { createdAt: '2026-02-30T00:00:00.000Z' }, { issuer: 'http://example.invalid' }, { email: 'unexpected' }])
    assert.throws(() => parseGrantMutationResult(result(change, extra)));
});

test('client uses bounded closed PUT/DELETE bodies, safe fetch policies and exact result echoes', async () => {
  const calls = [];
  const client = new ApiClient({ fetchImpl: async (url, init) => {
    calls.push({ url, init }); return response(result({ ...JSON.parse(init.body), role: init.method === 'DELETE' ? null : JSON.parse(init.body).role }));
  } });
  await client.changeGrant('sembom', change);
  const revoke = { ...change, role: null, expectedRole: 'owner' }; await client.changeGrant('sembom', revoke);
  assert.equal(calls[0].url, '/v1/projects/sembom/grants'); assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].init.body), change);
  assert.equal(calls[1].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[1].init.body), { ...identity, expectedRole: 'owner' });
  assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  for (const extra of [{ issuer: 'http://example.invalid' }, { subject: '' }, { caller: 'asserted' }, { role: 'admin' }])
    await assert.rejects(client.changeGrant('sembom', { ...change, ...extra }), e => e.kind === 'invalid_request');
  assert.equal(calls.length, 2);
  for (const extra of [{ projectId: 'other' }, { issuer: 'https://other.example.invalid' }, { subject: 'other' }, { role: 'owner' }])
    await assert.rejects(new ApiClient({ fetchImpl: async () => response(result(change, extra)) }).changeGrant('sembom', change), e => e.kind === 'contract');
});

test('review is explicit; duplicate confirmations and attempted candidate changes cannot race a write', async () => {
  const calls = [], pending = defer(), saved = [];
  const client = new ApiClient({ fetchImpl: async (url, init) => { calls.push(init); return pending.promise; } });
  const editor = new GrantEditor(client, 'sembom', { onSaved: value => saved.push(value) });
  assert.equal(editor.prepare(change), true); assert.equal(editor.state.phase, 'review'); assert.equal(calls.length, 0);
  const writing = editor.confirm(); await tick();
  await editor.confirm(); editor.cancel(); assert.equal(editor.prepare({ ...change, subject: 'other' }), false);
  assert.equal(editor.state.phase, 'saving'); assert.equal(calls.length, 1);
  pending.resolve(response(result())); await writing;
  assert.equal(saved.length, 1); assert.equal(editor.state.phase, 'success'); assert.equal(editor.state.change, null);
  await editor.confirm(); assert.equal(calls.length, 1); editor.destroy();
});

test('lost response freezes the reviewed request and only explicit exact retry can resolve it', async () => {
  const calls = []; let count = 0;
  const client = new ApiClient({ fetchImpl: async (url, init) => {
    calls.push(init.body); if (++count === 1) throw new Error('private network details');
    return response(result(change, { changed: false }));
  } });
  const editor = new GrantEditor(client, 'sembom'); const candidate = { ...change };
  editor.prepare(candidate); candidate.subject = 'changed-outside'; await editor.confirm();
  assert.equal(editor.state.phase, 'uncertain'); assert.equal(calls.length, 1);
  assert.ok(!editor.state.message.includes('private'));
  assert.throws(() => { editor.state.change.subject = 'changed-through-state'; });
  editor.cancel(); assert.equal(editor.state.phase, 'uncertain'); assert.equal(editor.prepare({ ...change, role: 'owner' }), false);
  await editor.confirm(); assert.deepEqual(calls, [JSON.stringify(change), JSON.stringify(change)]);
  assert.equal(editor.state.phase, 'success'); assert.match(editor.state.message, /이미/); editor.destroy();
});

test('role conflict and last owner are actionable failures; storage/invalid successful response stay uncertain', async () => {
  for (const code of ['grant_conflict', 'last_owner']) {
    const editor = new GrantEditor(new ApiClient({ fetchImpl: async () => failure(409, code) }), 'sembom');
    editor.prepare(change); await editor.confirm(); assert.equal(editor.state.phase, 'error');
    assert.ok(!editor.state.message.includes('private')); assert.match(editor.state.message, code === 'last_owner' ? /마지막 소유자/ : /최신 목록/);
    await editor.confirm(); assert.equal(editor.state.phase, 'error'); editor.cancel(); assert.equal(editor.state.change, null); editor.destroy();
  }
  for (const value of [failure(503, 'storage_unavailable'), response(result(change, { projectId: 'other' }))]) {
    const editor = new GrantEditor(new ApiClient({ fetchImpl: async () => value }), 'sembom');
    editor.prepare(change); await editor.confirm(); assert.equal(editor.state.phase, 'uncertain'); editor.destroy();
  }
});

test('self-access loss and authorization failures notify once, clear pending identities and prevent more writes', async () => {
  for (const value of [failure(401, 'unauthorized'), failure(403, 'forbidden'), response(result(change, { canManage: false }))]) {
    let lost = 0, saved = 0;
    const editor = new GrantEditor(new ApiClient({ fetchImpl: async () => value }), 'sembom', {
      onAccessLost: () => { lost++; }, onSaved: () => { saved++; throw Error('private UI failure'); },
    });
    editor.prepare(change); await editor.confirm(); assert.equal(lost, 1); assert.equal(editor.state.change, null);
    assert.equal(editor.state.phase, value.ok ? 'success' : 'denied'); assert.equal(saved, value.ok ? 1 : 0);
    assert.equal(editor.prepare(change), false);
    editor.destroy();
  }
});

test('dispose aborts an in-flight write and ignores its late response and access callbacks', async () => {
  const pending = defer(); let signal, calls = 0;
  const client = new ApiClient({ fetchImpl: async (url, init) => { signal = init.signal; return pending.promise; } });
  const editor = new GrantEditor(client, 'sembom', { onSaved: () => { calls++; }, onAccessLost: () => { calls++; } });
  editor.prepare(change); const writing = editor.confirm(); await tick(); editor.destroy();
  assert.equal(signal.aborted, true); pending.resolve(response(result(change, { canManage: false }))); await writing;
  assert.equal(calls, 0); assert.equal(editor.state.change, null); assert.equal(editor.prepare(change), false);
});
