import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ApiClient, ApiError } from './client.ts';
import { parseAdminChangePage } from './admin-changes-contract.ts';
import { AdminChangeList } from './admin-change-list.ts';

const example = JSON.parse(readFileSync(new URL('../../../../api/examples/admin-changes.json', import.meta.url), 'utf8'));
const id = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const row = i => ({ ...structuredClone(example.data[0]), id: id(i) });
const encode = i => Buffer.from(JSON.stringify([1, 'sembom', Date.parse(row(i).occurredAt), id(i)])).toString('base64url');
const page = (ids = [1], more = false) => ({ ...structuredClone(example), data: ids.map(row), page: { limit: 25, nextCursor: more ? encode(ids.at(-1)) : null } });
const firstPage = () => page(Array.from({ length: 25 }, (_, i) => 100 - i), true);
const response = value => ({ ok: true, status: 200, json: async () => value });
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('closed history parser accepts the wire example and rejects missing, contradictory or private fields', () => {
  assert.deepEqual(parseAdminChangePage(example), example); assert.deepEqual(parseAdminChangePage(page([])), page([]));
  for (const mutate of [
    v => v.extra = true, v => v.projectId = 'BAD', v => v.retentionDays = 365, v => v.coverage = 'complete',
    v => v.generatedAt = '2026-02-30T00:00:00.000Z', v => v.data[0].id = 'bad',
    v => v.data[0].occurredAt = '2026-10-12T00:00:00.000Z', v => v.data[0].occurredAt = '2020-01-01T00:00:00.000Z',
    v => v.data[0].actor.subject = '', v => v.data[0].actor.issuer += '?query=1', v => v.data[0].actor.email = 'private',
    v => v.data[0].actor = { kind: 'local_operator', subject: 'inferred' }, v => v.data[0].requestBody = {},
    v => v.data[0].change.beforeRole = null, v => v.data[0].change.afterRole = 'reader',
    v => v.data[0].change.target.token = 'extra', v => v.page.limit = 101,
    v => v.page.nextCursor = '', v => v.page.nextCursor = 'bad cursor', v => v.page.nextCursor = encode(1),
    v => v.data.push(v.data[0]), v => v.data.push(row(2)),
  ]) { const value = page(); mutate(value); assert.throws(() => parseAdminChangePage(value)); }
  for (const change of [{ action: 'project.created', name: 'raw value' }, { action: 'project.settings_changed', fields: [] },
    { action: 'project.settings_changed', fields: ['name', 'name'] }, { action: 'project.settings_changed', fields: ['token'] },
    { action: 'schema.published', schemaVersion: 0 }, { action: 'schema.published', schemaVersion: 2, definitions: {} }]) {
    const value = page(); value.data[0].change = change; assert.throws(() => parseAdminChangePage(value));
  }
  const valid = firstPage(); assert.deepEqual(parseAdminChangePage(valid), valid);
  valid.page.nextCursor = encode(75); assert.throws(() => parseAdminChangePage(valid));
});

test('closed history parser accepts publisher authority actions with identity-only targets', () => {
  const publisher = (action, target = { issuer: 'https://machine.example.invalid', subject: 'build-bot' }) => {
    const value = page([2, 1]); value.data[0].change = { action, target }; return value;
  };
  for (const action of ['publisher.granted', 'publisher.revoked']) {
    const value = publisher(action); assert.deepEqual(parseAdminChangePage(value), value);
  }
  for (const mutate of [
    v => v.data[0].change.beforeRole = 'owner', v => v.data[0].change.afterRole = null,
    v => v.data[0].change.role = 'owner', v => v.data[0].change.fields = ['name'],
    v => v.data[0].change.target.token = 'extra', v => delete v.data[0].change.target.subject,
    v => delete v.data[0].change.target, v => v.data[0].change.target = 'https://machine.example.invalid',
    v => v.data[0].change.target.issuer = 'http://machine.example.invalid',
    v => v.data[0].change.target.issuer = 'https://machine.example.invalid?aud=1',
    v => v.data[0].change.target.issuer = 'https://machine.example.invalid#fragment',
    v => v.data[0].change.target.issuer = ' https://machine.example.invalid',
    v => v.data[0].change.target.issuer = 'https://user:pass@machine.example.invalid',
    v => v.data[0].change.target.subject = ' ', v => v.data[0].change.target.subject = 'build\u0000bot',
    v => v.data[0].change.target.subject = 's'.repeat(513),
    v => v.data[0].change.action = 'publisher.created', v => v.data[0].change.action = 'grant.created',
    v => v.data[0].change = { action: 'publisher.granted' },
    v => v.data[0].change = { action: 'publisher.granted', target: { issuer: 'https://machine.example.invalid' } },
    v => v.data[0].change = { action: 'publisher.granted', target: { issuer: 'https://machine.example.invalid', subject: 'build-bot', role: null } },
  ]) { const value = publisher('publisher.granted'); mutate(value); assert.throws(() => parseAdminChangePage(value)); }
});

test('client uses same-origin safe policy, checks project/limit and cursor progress, and sends no invalid cursor', async () => {
  const calls = [], client = new ApiClient({ fetchImpl: async (url, init) => { calls.push({ url, init }); return response(page([75])); } });
  await client.listChanges('sembom', { cursor: encode(76) });
  assert.equal(calls[0].url, `/v1/projects/sembom/changes?limit=25&cursor=${encode(76)}`);
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined);
  for (const value of [{ ...page(), projectId: 'other' }, { ...page(), page: { limit: 24, nextCursor: null } }, page([76])])
    await assert.rejects(new ApiClient({ fetchImpl: async () => response(value) }).listChanges('sembom', { cursor: encode(76) }), error => error.kind === 'contract');
  for (const cursor of ['bad cursor', 'x'.repeat(513), Buffer.from(JSON.stringify([1, 'other', 1, id(1)])).toString('base64url')])
    await assert.rejects(client.listChanges('sembom', { cursor }), error => error instanceof ApiError && error.kind === 'invalid_request');
  assert.equal(calls.length, 1); client.destroy();
});

test('one-page controller replaces rows, suppresses duplicate next clicks, stops at the end and refreshes from the start', async () => {
  const urls = [], pending = defer(), client = new ApiClient({ fetchImpl: async url => {
    urls.push(url); return url.includes('cursor=') ? pending.promise : response(firstPage());
  } });
  const list = new AdminChangeList(client, 'sembom'); await list.refresh();
  const next = list.next(); await tick(); assert.equal(list.state.phase, 'loading'); assert.equal(list.state.data, null);
  await list.next(); assert.equal(urls.length, 2);
  pending.resolve(response(page([75]))); await next;
  assert.equal(list.state.pageNumber, 2); assert.deepEqual(list.state.data.data.map(r => r.id), [id(75)]);
  await list.next(); assert.equal(urls.length, 2);
  await list.refresh(); assert.equal(list.state.pageNumber, 1); assert.equal(urls.length, 3); assert.ok(!urls[2].includes('cursor='));
  list.destroy(); client.destroy();
});

test('denial clears identities and blocks retry while network failure retries exactly the failed page', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const client = new ApiClient({ fetchImpl: async () => ++calls === 1 ? response(firstPage()) :
      { ok: false, status, json: async () => ({ error: { message: 'private details' } }) } });
    const list = new AdminChangeList(client, 'sembom'); await list.refresh(); await list.next();
    assert.equal(list.state.denied, true); assert.equal(list.state.data, null); await list.retry(); assert.equal(calls, 2);
    assert.ok(!list.state.message.includes('private details')); list.destroy(); client.destroy();
  }
  const urls = [], client = new ApiClient({ fetchImpl: async url => {
    urls.push(url); if (urls.length === 1) return response(firstPage());
    if (urls.length === 2) throw Error('private transport'); return response(page([75]));
  } });
  const list = new AdminChangeList(client, 'sembom'); await list.refresh(); await list.next();
  assert.equal(list.state.phase, 'error'); assert.equal(list.state.denied, false); assert.equal(list.state.data, null);
  assert.ok(!list.state.message.includes('private transport'));
  await list.retry(); assert.equal(urls[1], urls[2]); assert.equal(list.state.pageNumber, 2);
  list.destroy(); client.destroy();
});

test('new reads abort old ones and stale/disposed responses cannot restore prior project records', async () => {
  const older = defer(), newer = defer(), signals = []; let count = 0;
  const client = new ApiClient({ fetchImpl: async (url, init) => { signals.push(init.signal); return ++count === 1 ? older.promise : newer.promise; } });
  const list = new AdminChangeList(client, 'sembom'); const old = list.refresh(); await tick(); const fresh = list.refresh(); await tick();
  assert.equal(signals[0].aborted, true); newer.resolve(response(page([2]))); await fresh;
  older.resolve(response(page([1]))); await old; assert.equal(list.state.data.data[0].id, id(2));
  const pending = defer(), second = new ApiClient({ fetchImpl: async () => pending.promise }), disposed = new AdminChangeList(second, 'other');
  const running = disposed.refresh(); await tick(); disposed.destroy(); pending.resolve(response({ ...page(), projectId: 'other' })); await running;
  assert.equal(disposed.state.data, null); list.destroy(); client.destroy(); second.destroy();
});
