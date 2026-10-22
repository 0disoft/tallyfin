import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { GrantList } from './grant-list.ts';
import { parseProjectGrantPage } from './grants-contract.ts';

const row = (subject = 'test-owner', role = 'owner') => ({ issuer: 'https://identity.example.invalid', subject, role, createdAt: '2026-10-11T00:00:00.000Z' });
const page = (subjects = ['test-owner'], nextCursor = null) => ({ projectId: 'sembom', grantRevision: 0, data: subjects.map(subject => row(subject)), page: { limit: 25, nextCursor } });
const response = value => ({ ok: true, status: 200, json: async () => value });
const denied = status => ({ ok: false, status, json: async () => ({ error: { message: 'private server details' } }) });
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('grant page parser validates closed shape, roles, IDs, time, bounds and duplicate identities', () => {
  assert.deepEqual(parseProjectGrantPage(page()), page());
  assert.deepEqual(parseProjectGrantPage(page([])), page([]));
  for (const mutate of [v => delete v.grantRevision, v => v.grantRevision = -1, v => v.grantRevision = 0.5, v => v.grantRevision = Number.MAX_SAFE_INTEGER + 1, v => v.data[0].role = 'admin', v => v.data[0].subject = '', v => v.data[0].subject = 'x'.repeat(513),
    v => v.data[0].subject = '\n', v => v.data[0].issuer = 'http://identity.example.invalid', v => v.data[0].issuer += '?private=1',
    v => v.data[0].createdAt = '2026-02-30T00:00:00.000Z', v => v.data[0].createdAt = 'yesterday', v => v.data[0].email = 'extra',
    v => v.page.limit = 101, v => v.page.nextCursor = 'bad cursor', v => v.page.nextCursor = 'x'.repeat(12289),
    v => v.page.nextCursor = 'valid-position', v => v.data.push(v.data[0]), v => v.projectId = 'BAD', v => v.extra = true]) {
    const value = page(); mutate(value); assert.throws(() => parseProjectGrantPage(value));
  }
  const unicode = page(); unicode.data[0].subject = '가😀"'.repeat(127);
  assert.equal(parseProjectGrantPage(unicode).data[0].subject, unicode.data[0].subject);
});

test('client requests the owner endpoint with safe fetch policy and rejects mismatched/nonprogressing responses', async () => {
  const calls = [];
  const client = new ApiClient({ fetchImpl: async (url, init) => { calls.push({ url, init }); return response(page()); } });
  await client.listGrants('sembom', { cursor: 'page-position' });
  const call = calls[0]; assert.equal(call.url, '/v1/projects/sembom/grants?limit=25&cursor=page-position');
  assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.cache, 'no-store'); assert.equal(call.init.referrerPolicy, 'no-referrer');
  assert.equal(call.init.body, undefined); assert.equal(call.init.method, 'GET');
  for (const mutate of [v => v.projectId = 'other', v => v.page.limit = 24]) {
    const value = page(); mutate(value);
    await assert.rejects(new ApiClient({ fetchImpl: async () => response(value) }).listGrants('sembom'), error => error instanceof ApiError && error.kind === 'contract');
  }
  const value = page(Array.from({ length: 25 }, (_, i) => `u${i}`), 'page-position');
  await assert.rejects(new ApiClient({ fetchImpl: async () => response(value) }).listGrants('sembom', { cursor: 'page-position' }), error => error.kind === 'contract');
  await assert.rejects(client.listGrants('sembom', { cursor: 'invalid cursor' }), error => error.kind === 'invalid_request');
  assert.equal(calls.length, 1);
});

test('next page replaces the visible page, duplicate clicks do not race, and refresh restarts from the first page', async () => {
  const calls = [], pending = defer();
  const client = new ApiClient({ fetchImpl: async url => {
    calls.push(url);
    if (url.includes('cursor=')) return pending.promise;
    return response(page(Array.from({ length: 25 }, (_, i) => `u${i}`), 'page-position'));
  } });
  const list = new GrantList(client, 'sembom'); await list.refresh();
  assert.equal(list.state.data.data.length, 25);
  const next = list.next(); await tick();
  assert.equal(list.state.phase, 'loading'); assert.equal(list.state.data, null);
  await list.next(); assert.equal(calls.length, 2);
  pending.resolve(response(page(['next-reader']))); await next;
  assert.equal(list.state.pageNumber, 2); assert.deepEqual(list.state.data.data.map(g => g.subject), ['next-reader']);
  await list.next(); assert.equal(calls.length, 2);
  await list.refresh(); assert.equal(list.state.pageNumber, 1); assert.equal(calls.length, 3); assert.ok(!calls[2].includes('cursor='));
  list.destroy(); client.destroy();
});

test('401 and 403 on the next page clear identities and lock retry instead of retaining a stale list', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const client = new ApiClient({ fetchImpl: async () => ++calls === 1
      ? response(page(Array.from({ length: 25 }, (_, i) => `u${i}`), 'page-position')) : denied(status) });
    const list = new GrantList(client, 'sembom'); await list.refresh(); await list.next();
    assert.equal(list.state.phase, 'error'); assert.equal(list.state.data, null); assert.equal(list.state.denied, true);
    assert.ok(!list.state.message.includes('private server details'));
    await list.retry(); assert.equal(calls, 2);
    list.destroy(); client.destroy();
  }
});

test('network failure clears the page and retry requests the failed cursor again', async () => {
  const urls = [];
  const client = new ApiClient({ fetchImpl: async url => {
    urls.push(url);
    if (urls.length === 1) return response(page(Array.from({ length: 25 }, (_, i) => `u${i}`), 'page-position'));
    if (urls.length === 2) throw Error('private transport detail');
    return response(page(['recovered']));
  } });
  const list = new GrantList(client, 'sembom'); await list.refresh(); await list.next();
  assert.equal(list.state.phase, 'error'); assert.equal(list.state.data, null); assert.equal(list.state.denied, false);
  assert.ok(!list.state.message.includes('private transport detail'));
  await list.retry(); assert.equal(urls[2], urls[1]); assert.equal(list.state.pageNumber, 2); assert.equal(list.state.data.data[0].subject, 'recovered');
  list.destroy(); client.destroy();
});

test('superseded response and destroyed project controller cannot restore private identities', async () => {
  const first = defer(), second = defer(), signals = []; let calls = 0;
  const client = new ApiClient({ fetchImpl: async (url, init) => { signals.push(init.signal); return ++calls === 1 ? first.promise : second.promise; } });
  const list = new GrantList(client, 'sembom');
  const stale = list.refresh(); await tick(); const current = list.refresh(); await tick();
  assert.equal(signals[0].aborted, true);
  second.resolve(response(page(['current']))); await current;
  first.resolve(response(page(['stale']))); await stale;
  assert.equal(list.state.data.data[0].subject, 'current');
  const third = defer();
  const otherClient = new ApiClient({ fetchImpl: async () => third.promise });
  const other = new GrantList(otherClient, 'other'); const running = other.refresh(); await tick(); other.destroy();
  third.resolve(response({ ...page(['old-project']), projectId: 'other' })); await running;
  assert.equal(other.state.data, null);
  list.destroy(); assert.equal(list.state.data, null); client.destroy(); otherClient.destroy();
});
