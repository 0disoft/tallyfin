import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE_PATH, ApiClient, ApiError, clampLimit, resolveApiEndpoint } from './client.ts';
import { missingBrowserEvents } from './coverage.ts';
import { appendPage, shouldApplyPage } from './pagination.ts';
import { periodRange, todayInZone } from './dates.ts';

const TOKEN = 'test-bearer-token-value';
const REQUEST_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function capture(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { calls, fetchImpl };
}

const project = id => ({ id, name: `Project ${id}`, status: 'active', timeZone: 'Asia/Seoul' });
const meta = (projectId, schemaVersion, from, to) => ({ projectId, schemaVersion, source: 'browser', from, to, timeZone: 'Asia/Seoul', generatedAt: '2026-10-08T00:00:00Z', latestReceivedAt: null, coverage: 'observed-only' });

test('list requests keep the token in the header only and disable storage and caching', async () => {
  const { calls, fetchImpl } = capture(() => jsonResponse(200, { data: [project('modufile')], page: { limit: 25, nextCursor: null } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const page = await client.listProjects({ limit: 500 });
  assert.equal(page.data[0].id, 'modufile');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_BASE_PATH}/projects?limit=100`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.body, undefined);
  assert.ok(!calls[0].url.includes(TOKEN));
});

test('the token never leaks through serialization or error text', async () => {
  const { fetchImpl } = capture(() => jsonResponse(401, { error: { code: 'unauthorized', message: `echo ${TOKEN}`, requestId: REQUEST_ID } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  assert.ok(!JSON.stringify(client).includes(TOKEN));
  assert.ok(!String(client).includes(TOKEN));
  await assert.rejects(() => client.listProjects(), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, 'unauthorized');
    assert.ok(!error.message.includes(TOKEN));
    assert.equal(error.status, 401);
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.requestId, REQUEST_ID);
    return true;
  });
});

test('server error text is replaced by a fixed message', async () => {
  const { fetchImpl } = capture(() => jsonResponse(403, { error: { code: 'forbidden', message: `echo ${TOKEN}`, requestId: REQUEST_ID } }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  await assert.rejects(() => client.listProjects(), error => {
    assert.equal(error.kind, 'forbidden');
    assert.equal(error.message, '이 프로젝트에 대한 권한이 없어요. (HTTP 403)');
    assert.ok(!error.message.includes(TOKEN));
    return true;
  });
});

test('clampLimit keeps every page within 1..100', () => {
  assert.equal(clampLimit(undefined), 25);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(1000), 100);
  assert.equal(clampLimit(12.7), 12);
});

test('each query shape matches the openapi paths and required parameters', async () => {
  const { calls, fetchImpl } = capture(url => {
    if (url.includes('/schemas/')) return jsonResponse(200, { project: project('sembom'), schemaVersion: 3, schemaStatus: 'retired', allowedOrigins: ['https://a.example'], limits: { requestsPerMinute: 60, newReceiptsPerUtcDay: 1000 }, events: [{ name: 'input_start', label: '입력 시작', source: 'browser', properties: {} }], workflows: [] });
    if (url.includes('/summary')) return jsonResponse(200, { meta: meta('sembom', 3, '2026-10-02', '2026-10-08'), totalEvents: 0, events: [{ name: 'input_start', count: 0 }] });
    if (url.includes('/events/')) return jsonResponse(200, { meta: meta('sembom', 3, '2026-10-02', '2026-10-08'), eventName: 'input_start', groupBy: 'tool', totalEvents: 0, days: [{ date: '2026-10-08', count: 0, breakdown: [] }] });
    return jsonResponse(200, { meta: meta('sembom', 3, '2026-10-02', '2026-10-08'), workflowId: 'calc', cohortBasis: 'startedAt', summary: { startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null }, days: [{ date: '2026-10-08', startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null, provisional: true }] });
  });
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const range = { schemaVersion: 3, from: '2026-10-02', to: '2026-10-08' };
  const registry = await client.getSchema('sembom', 3);
  assert.equal(registry.schemaStatus, 'retired');
  await client.getSummary('sembom', range);
  await client.getEventDaily('sembom', 'input_start', { ...range, groupBy: 'tool' });
  await client.getWorkflowDaily('sembom', 'calc', range);
  assert.deepEqual(calls.map(call => call.url), [
    `${API_BASE_PATH}/projects/sembom/schemas/3`,
    `${API_BASE_PATH}/projects/sembom/summary?schemaVersion=3&from=2026-10-02&to=2026-10-08`,
    `${API_BASE_PATH}/projects/sembom/events/input_start/daily?schemaVersion=3&from=2026-10-02&to=2026-10-08&groupBy=tool`,
    `${API_BASE_PATH}/projects/sembom/workflows/calc/daily?schemaVersion=3&from=2026-10-02&to=2026-10-08`,
  ]);
});

test('only same-origin /v1 endpoints are accepted', () => {
  const origin = 'https://admin.example.com';
  assert.deepEqual(resolveApiEndpoint('', origin), { basePath: API_BASE_PATH });
  assert.deepEqual(resolveApiEndpoint(`${origin}${API_BASE_PATH}`, origin), { basePath: API_BASE_PATH });
  assert.deepEqual(resolveApiEndpoint(`${origin}/`, origin), { basePath: API_BASE_PATH });
  for (const rejected of [`https://evil.example.com`, 'http://localhost:5180', `${origin}/api`, `${origin}${API_BASE_PATH}?x=1`, `${origin}#frag`, `https://user:pass@admin.example.com`]) {
    assert.ok('error' in resolveApiEndpoint(rejected, origin), rejected);
  }
  assert.throws(() => new ApiClient({ token: TOKEN, basePath: 'https://evil.example.com' }), error => error instanceof ApiError && error.kind === 'invalid_request');
});

test('http, network and contract failures stay distinct and never become zeros', async () => {
  const cases = [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [503, 'storage_unavailable'], [400, 'invalid_request'], [500, 'http']];
  for (const [status, kind] of cases) {
    const { fetchImpl } = capture(() => jsonResponse(status, { error: { code: 'x', requestId: REQUEST_ID } }));
    const client = new ApiClient({ token: TOKEN, fetchImpl });
    await assert.rejects(() => client.listProjects(), error => { assert.equal(error.kind, kind); assert.equal(error.status, status); return true; });
  }
  const offline = new ApiClient({ token: TOKEN, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => offline.listProjects(), error => { assert.equal(error.kind, 'network'); return true; });
  for (const body of [{ data: [project('a')], page: { limit: 500, nextCursor: null } }, { data: [project('a')], page: { limit: 25 } }, { data: {}, page: { limit: 25, nextCursor: null } }]) {
    const { fetchImpl } = capture(() => jsonResponse(200, body));
    const client = new ApiClient({ token: TOKEN, fetchImpl });
    await assert.rejects(() => client.listProjects(), error => { assert.equal(error.kind, 'contract'); return true; });
  }
  const { fetchImpl } = capture(() => jsonResponse(200, { meta: meta('a', 1, '2026-10-02', '2026-10-08'), totalEvents: '0', events: [{ name: 'x', count: 0 }] }));
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  await assert.rejects(() => client.getSummary('a', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
});

test('valid but mismatched responses are rejected', async () => {
  const wrongMeta = capture(() => jsonResponse(200, { meta: meta('other', 1, '2026-10-02', '2026-10-08'), totalEvents: 0, events: [{ name: 'x', count: 0 }] }));
  await assert.rejects(() => new ApiClient({ token: TOKEN, fetchImpl: wrongMeta.fetchImpl }).getSummary('a', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
  const wrongEvent = capture(() => jsonResponse(200, { meta: meta('a', 1, '2026-10-02', '2026-10-08'), eventName: 'other', groupBy: null, totalEvents: 0, days: [{ date: '2026-10-08', count: 0, breakdown: [] }] }));
  await assert.rejects(() => new ApiClient({ token: TOKEN, fetchImpl: wrongEvent.fetchImpl }).getEventDaily('a', 'input_start', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
  const wrongWorkflow = capture(() => jsonResponse(200, { meta: meta('a', 1, '2026-10-02', '2026-10-08'), workflowId: 'other', cohortBasis: 'startedAt', summary: { startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null }, days: [{ date: '2026-10-08', startedAttempts: 0, succeededAttempts: 0, failedAttempts: null, pendingAttempts: 0, completionRate: null, provisional: false }] }));
  await assert.rejects(() => new ApiClient({ token: TOKEN, fetchImpl: wrongWorkflow.fetchImpl }).getWorkflowDaily('a', 'calc', { schemaVersion: 1, from: '2026-10-02', to: '2026-10-08' }), error => { assert.equal(error.kind, 'contract'); return true; });
});

test('destroy clears the token and aborts pending requests', async () => {
  let seenSignal = null;
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
  });
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const pending = client.listProjects();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.hasToken, true);
  client.destroy();
  assert.equal(client.hasToken, false);
  assert.equal(seenSignal.aborted, true);
  await assert.rejects(() => pending, error => { assert.equal(error.name, 'AbortError'); return true; });
});

test('destroy aborts an in-flight response body read', async () => {
  let seenSignal = null;
  const fetchImpl = async (_url, init) => {
    seenSignal = init.signal;
    return {
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
      }),
    };
  };
  const client = new ApiClient({ token: TOKEN, fetchImpl });
  const pending = client.listProjects();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seenSignal.aborted, false);
  client.destroy();
  assert.equal(seenSignal.aborted, true);
  await assert.rejects(() => pending, error => { assert.equal(error.name, 'AbortError'); return true; });
});

test('stale pagination results are discarded after a reconnect', () => {
  assert.equal(shouldApplyPage({ generation: 2, current: 2, aborted: false }), true);
  assert.equal(shouldApplyPage({ generation: 1, current: 2, aborted: false }), false);
  assert.equal(shouldApplyPage({ generation: 2, current: 2, aborted: true }), false);
  const next = appendPage([{ id: 'a' }], { data: [{ id: 'b' }], page: { limit: 25, nextCursor: 'b' } });
  assert.deepEqual(next.items.map(item => item.id), ['a', 'b']);
  assert.equal(next.nextCursor, 'b');
});

test('a summary that omits a registered browser event is reported, not zero-filled', () => {
  const registry = { events: [{ name: 'tool_view', source: 'browser' }, { name: 'start', source: 'browser' }, { name: 'server_ping', source: 'server' }] };
  assert.deepEqual(missingBrowserEvents(registry, { events: [{ name: 'tool_view', count: 3 }, { name: 'start', count: 1 }] }), []);
  assert.deepEqual(missingBrowserEvents(registry, { events: [{ name: 'tool_view', count: 3 }] }), ['start']);
  assert.deepEqual(missingBrowserEvents(registry, { events: [] }), ['tool_view', 'start']);
});

test('project-local dates follow the project time zone and 7/14/30 periods', () => {
  assert.equal(todayInZone('Asia/Seoul', new Date('2026-10-08T15:30:00Z')), '2026-10-09');
  assert.equal(todayInZone('Asia/Seoul', new Date('2026-10-08T14:30:00Z')), '2026-10-08');
  assert.deepEqual(periodRange('2026-10-08', 7), { from: '2026-10-02', to: '2026-10-08' });
  assert.deepEqual(periodRange('2026-10-08', 30), { from: '2026-09-09', to: '2026-10-08' });
});

test('the default fetch keeps the global receiver instead of the client', async () => {
  const original = globalThis.fetch;
  let receiver = null;
  globalThis.fetch = async function () { receiver = this; return jsonResponse(200, { data: [], page: { limit: 25, nextCursor: null } }); };
  try {
    await new ApiClient({ token: TOKEN }).listProjects();
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = original;
  }
});

test('each request reads the current bearer and destroy disposes the login once', async () => {
  const { calls, fetchImpl } = capture(() => jsonResponse(200, { data: [], page: { limit: 25, nextCursor: null } }));
  let current = TOKEN;
  let destroyed = 0;
  const client = new ApiClient({ getBearer: async () => current, onDestroy: () => { destroyed++; }, fetchImpl });
  assert.equal(client.hasToken, true);
  await client.listProjects();
  current = `${TOKEN}-rotated`;
  await client.listProjects();
  assert.deepEqual(calls.map(call => call.init.headers.Authorization), [`Bearer ${TOKEN}`, `Bearer ${current}`]);
  assert.ok(!JSON.stringify(client).includes(TOKEN));
  client.destroy(); client.destroy();
  assert.equal(destroyed, 1);
  assert.equal(client.hasToken, false);
});

test('failed or empty token providers return a fixed 401 without calling the API', async () => {
  for (const getBearer of [async () => { throw new Error(TOKEN); }, async () => '']) {
    const { calls, fetchImpl } = capture(() => { throw new Error('API must not be called'); });
    const client = new ApiClient({ getBearer, fetchImpl });
    await assert.rejects(client.listProjects(), error => error.kind === 'unauthorized' && error.status === 401 && !error.message.includes(TOKEN));
    assert.equal(calls.length, 0);
    client.destroy();
  }
});

test('abort while awaiting shared refresh ends only that request and destroy prevents late fetch', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { calls, fetchImpl } = capture(() => jsonResponse(200, { data: [], page: { limit: 25, nextCursor: null } }));
  const client = new ApiClient({ getBearer: () => waiting, fetchImpl });
  const controller = new AbortController();
  const aborted = client.listProjects({ signal: controller.signal });
  const surviving = client.listProjects();
  controller.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');
  assert.equal(calls.length, 0);
  release(TOKEN);
  await surviving;
  assert.equal(calls.length, 1);
  client.destroy();

  let lateRelease;
  const late = new Promise(resolve => { lateRelease = resolve; });
  const disconnected = new ApiClient({ getBearer: () => late, fetchImpl });
  const pending = disconnected.listProjects();
  disconnected.destroy();
  await assert.rejects(pending, error => error.name === 'AbortError');
  lateRelease(TOKEN);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
});
