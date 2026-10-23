import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { ApiError as TransportError } from './api-error.ts';
import { AdminTransport } from './transport.ts';

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
