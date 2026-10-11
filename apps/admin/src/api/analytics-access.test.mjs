import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from './client.ts';

const range = { schemaVersion: 1, from: '2026-10-07', to: '2026-10-08' };
const denied = (status, json = async () => ({ error: { code: 'forbidden' } })) => ({ ok: false, status, json });
test('all analytics reads invalidate their project on observed 403, once per request', async () => {
  const calls = [];
  const client = new ApiClient({ fetchImpl: async () => denied(403), onAnalyticsAccessDenied: (id, error) => calls.push([id, error.status]) });
  const reads = [() => client.getSchema('sembom', 1), () => client.getSummary('sembom', range),
    () => client.getEventDaily('sembom', 'tool_view', range), () => client.getWorkflowDaily('sembom', 'convert', range),
    () => client.getWorkflowBreakdown('sembom', 'convert', { ...range, groupBy: 'tool' }),
    () => client.getFunnelDaily('sembom', 'convert', range), () => client.getFunnelBreakdown('sembom', 'convert', { ...range, groupBy: 'tool' })];
  for (const read of reads) await assert.rejects(read(), error => error.status === 403);
  assert.deepEqual(calls, reads.map(() => ['sembom', 403])); client.destroy();
});
test('a stalled denial body invalidates immediately while preserving its access error', async () => {
  for (const status of [401, 403]) {
    const calls = [];
    const client = new ApiClient({ requestTimeoutMs: 20, fetchImpl: async () => denied(status, () => new Promise(() => {})),
      onAnalyticsAccessDenied: (id, error) => calls.push([id, error.status]) });
    const pending = assert.rejects(client.getSummary('sembom', range), error => error.status === status);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['sembom', status]]);
    await pending; assert.equal(calls.length, 1); client.destroy();
  }
});
test('lost login invalidates analysis without fetching; cancellation cannot invalidate a later project', async () => {
  const calls = [];
  const client = new ApiClient({ getBearer: async () => { throw Error('private'); }, fetchImpl: async () => { assert.fail('unexpected fetch'); },
    onAnalyticsAccessDenied: (id, error) => calls.push([id, error.status]) });
  await assert.rejects(client.getSummary('sembom', range), error => error.status === 401);
  assert.deepEqual(calls, [['sembom', 401]]); client.destroy();
  let release;
  const stale = new ApiClient({ fetchImpl: () => new Promise(resolve => { release = resolve; }), onAnalyticsAccessDenied: () => assert.fail('stale denial') });
  const controller = new AbortController(), pending = stale.getSummary('sembom', { ...range, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  release(denied(403)); await new Promise(resolve => setImmediate(resolve)); stale.destroy();
});
test('owner-only denial and ordinary read failures preserve authorized analytics', async () => {
  const client = new ApiClient({ fetchImpl: async () => denied(403), onAnalyticsAccessDenied: () => assert.fail('owner-only failure') });
  for (const read of [() => client.listGrants('sembom'), () => client.listPublishers('sembom'), () => client.listChanges('sembom')]) {
    await assert.rejects(read(), error => error.status === 403);
  }
  // A write uses the same schema path but is not evidence that reader access was lost.
  await assert.rejects(client.publishSchema('sembom', 2, { events: [{ name: 'operation_completed', label: '작업 완료', source: 'browser', properties: {} }],
    workflows: [], expectedLatestVersion: 1, privacyReviewed: true }), error => error.status === 403); client.destroy();
  for (const status of [404, 409, 503]) {
    const reader = new ApiClient({ fetchImpl: async () => denied(status), onAnalyticsAccessDenied: () => assert.fail('non-access failure') });
    await assert.rejects(reader.getSummary('sembom', range), error => error.status === status); reader.destroy();
  }
});
