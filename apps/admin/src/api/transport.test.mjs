import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { ApiError as TransportError } from './api-error.ts';
import { AdminTransport } from './transport.ts';

test('authentication failures notify across read and write routes; 403 and 503 do not', async () => {
  for (const status of [401, 403, 503]) {
    for (const [path, body, method] of [['/identity'], ['/projects'], ['/projects/sample/schemas/draft', '{}', 'PUT']]) {
      let notifications = 0;
      const transport = new AdminTransport({ onUnauthorized(error) {
        assert.equal(error.status, 401); notifications++; throw Error('private observer failure');
      }, fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
      try {
        await assert.rejects(transport.request(path, {}, undefined, body, method), error => error instanceof ApiError && error.status === status);
        assert.equal(notifications, status === 401 ? 1 : 0);
      } finally { transport.destroy(); }
    }
  }
});

test('authentication is reported before a stalled error body and only once on timeout', async () => {
  let notifications = 0, notified;
  const observed = new Promise(resolve => { notified = resolve; });
  const transport = new AdminTransport({ requestTimeoutMs: 50, onUnauthorized() { notifications++; notified(); },
    fetchImpl: async () => ({ ok: false, status: 401, json: () => new Promise(() => {}) }) });
  try {
    const pending = assert.rejects(transport.request('/identity'), { status: 401 });
    await observed;
    assert.equal(notifications, 1);
    await pending;
    assert.equal(notifications, 1);
  } finally { transport.destroy(); }
});

test('refresh failures notify; cancelled or disposed requests cannot trigger login recovery', async () => {
  let notifications = 0;
  const refresh = new AdminTransport({ getBearer: async () => { throw Error('private refresh failure'); },
    onUnauthorized() { notifications++; }, fetchImpl: async () => { assert.fail('refresh failure must not fetch'); } });
  try {
    await assert.rejects(refresh.request('/identity'), { status: 401 });
    assert.equal(notifications, 1);
  } finally { refresh.destroy(); }
  for (const dispose of [false, true]) {
    let respond;
    const controller = new AbortController();
    const transport = new AdminTransport({ onUnauthorized() { notifications++; },
      fetchImpl: () => new Promise(resolve => { respond = resolve; }) });
    const pending = assert.rejects(transport.request('/identity', {}, controller.signal), { name: 'AbortError' });
    if (dispose) transport.destroy(); else controller.abort();
    respond({ ok: false, status: 401, json: async () => ({}) });
    await pending;
    assert.equal(notifications, 1);
    transport.destroy();
  }
});

test('access observers cannot replace a confirmed denial with a private callback exception', async () => {
  assert.equal(ApiError, TransportError);
  for (const status of [401, 403]) {
    let notifications = 0;
    const client = new ApiClient({ onAnalyticsAccessDenied(id, error) {
      assert.equal(id, 'sample'); assert.equal(error.status, status); notifications++; throw Error('private observer failure');
    }, fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: { code: status === 401 ? 'unauthorized' : 'forbidden' } }) }) });
    try {
      await assert.rejects(client.getSchema('sample', 1), error => error instanceof ApiError && error.status === status &&
        !JSON.stringify(error).includes('private observer failure'));
      assert.equal(notifications, 1);
    } finally { client.destroy(); }
  }
});

test('throwing disposal callbacks cannot retain access observers, credentials or pending requests', async () => {
  let notifications = 0, destructions = 0, signal;
  const cause = Error('private disposal failure');
  const transport = new AdminTransport({ token: 'synthetic-token', onDestroy() { destructions++; throw cause; },
    onAnalyticsAccessDenied() { notifications++; }, fetchImpl: async (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  const pending = transport.request('/projects');
  assert.throws(() => transport.destroy(), error => error === cause);
  assert.equal(signal.aborted, true); await assert.rejects(pending, { name: 'AbortError' });
  transport.notifyAccessDenied('sample', new ApiError('forbidden', 'fixed'));
  transport.destroy();
  assert.equal(transport.hasToken, false); assert.equal(notifications, 0); assert.equal(destructions, 1);
  assert.equal(JSON.stringify(transport), '"[AdminTransport]"');
});
