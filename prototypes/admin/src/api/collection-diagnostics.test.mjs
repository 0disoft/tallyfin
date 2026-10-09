import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './client.ts';
import { loadCollectionDiagnostics, originMatch, validateReceipt } from './collection-diagnostics.ts';

function fixture() {
  const settings = { project: { id: 'example', name: 'Example', status: 'paused', timeZone: 'Asia/Seoul' },
    allowedOrigins: ['https://app.example.com'], limits: { requestsPerMinute: 60, newReceiptsPerUtcDay: 1000 }, canEdit: false };
  const schema = { ...settings, schemaVersion: 2, schemaStatus: 'retired', events: [{ name: 'view', source: 'browser' }], workflows: [] };
  const summary = { meta: { projectId: 'example', schemaVersion: 2, source: 'browser', from: '2026-10-11', to: '2026-10-11', timeZone: 'Asia/Seoul',
    generatedAt: '2026-10-10T15:01:00Z', latestReceivedAt: null, coverage: 'observed-only' }, totalEvents: 0, events: [{ name: 'view', count: 0 }] };
  const calls = [];
  const client = { getSettings: async (...args) => { calls.push(['settings', ...args]); return settings; },
    getSchema: async (...args) => { calls.push(['schema', ...args]); return schema; },
    getSummary: async (...args) => { calls.push(['summary', ...args]); return summary; } };
  return { settings, schema, summary, client, calls };
}
const now = new Date('2026-10-10T15:01:00Z');
test('diagnostics use project-local today, preserve null/zero and paused/retired settings with read-only requests', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const data = await loadCollectionDiagnostics(f.client, 'example', 2, signal, now);
  assert.equal(data.settings.value.project.status, 'paused'); assert.equal(data.schema.value.schemaStatus, 'retired');
  assert.equal(data.receipt.value.meta.latestReceivedAt, null); assert.equal(data.receipt.value.totalEvents, 0);
  assert.deepEqual(f.calls.map(call => call[0]), ['settings', 'schema', 'summary']);
  assert.deepEqual(f.calls[2], ['summary', 'example', { schemaVersion: 2, from: '2026-10-11', to: '2026-10-11', signal }]);
  f.summary.meta.latestReceivedAt = '2026-10-01T00:00:00Z';
  assert.equal(validateReceipt(f.summary, f.schema, '2026-10-11').meta.latestReceivedAt, '2026-10-01T00:00:00Z');
  f.summary.meta.latestReceivedAt = '2026-10-10T15:01:00.100Z'; // DB read after generatedAt.
  assert.doesNotThrow(() => validateReceipt(f.summary, f.schema, '2026-10-11'));
});
test('partial read failures never become a no-receipt record and schema errors prevent the dependent summary read', async () => {
  const f = fixture(), error = new ApiError('storage_unavailable', 'Unavailable', 503), signal = new AbortController().signal;
  f.client.getSummary = async () => { throw error; };
  const failed = await loadCollectionDiagnostics(f.client, 'example', 2, signal, now);
  assert.ok(failed.settings.value); assert.ok(failed.schema.value); assert.equal(failed.receipt.error, error); assert.equal(failed.receipt.value, undefined);
  f.client.getSchema = async () => { throw new ApiError('not_found', 'Missing', 404); };
  f.client.getSummary = async () => assert.fail('must not query a missing schema');
  assert.equal((await loadCollectionDiagnostics(f.client, 'example', 2, signal, now)).receipt, null);
  f.client.getSchema = async () => assert.fail('must not query an invalid version');
  assert.equal((await loadCollectionDiagnostics(f.client, 'example', null, signal, now)).schema.error.kind, 'invalid_request');
  const g = fixture(); g.client.getSettings = async () => { throw error; };
  const partial = await loadCollectionDiagnostics(g.client, 'example', 2, signal, now);
  assert.equal(partial.settings.error, error); assert.ok(partial.receipt.value);
});
test('receipt validation rejects cross-project/version/zone/range responses, unsafe totals and invalid timestamps', () => {
  for (const change of [f => f.summary.meta.projectId = 'other', f => f.summary.meta.schemaVersion = 1,
    f => f.summary.meta.timeZone = 'UTC', f => f.summary.meta.from = '2026-10-10', f => f.summary.meta.coverage = 'all',
    f => f.summary.meta.generatedAt = 'invalid', f => f.summary.meta.latestReceivedAt = '2026-02-30T00:00:00Z',
    f => f.summary.events[0].count = -1, f => f.summary.events[0].name = 'unknown', f => f.summary.events.push(f.summary.events[0]),
    f => f.summary.totalEvents = 1, f => f.summary.totalEvents = Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); change(f); assert.throws(() => validateReceipt(f.summary, f.schema, '2026-10-11'));
  }
});
test('cancelled diagnostics cannot publish an old project result or launch its dependent summary read', async () => {
  const f = fixture(), controller = new AbortController(); let resolve;
  f.client.getSchema = () => new Promise(done => { resolve = done; });
  const pending = loadCollectionDiagnostics(f.client, 'example', 2, controller.signal, now);
  controller.abort(); resolve(f.schema);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(f.calls.map(call => call[0]), ['settings']);
});
test('local origin checks extract paths but require exact protocol, host and port without accepting credentials', () => {
  const allowed = ['https://app.example.com', 'http://localhost:5173'];
  assert.equal(originMatch('', allowed), 'empty'); assert.equal(originMatch('not a url', allowed), 'invalid');
  assert.equal(originMatch('https://app.example.com/tools/?q=x#section', allowed), 'allowed');
  for (const value of ['http://app.example.com', 'https://app.example.com.evil.test', 'https://app.example.com:8443', 'http://localhost:5174'])
    assert.equal(originMatch(value, allowed), 'denied');
  assert.equal(originMatch('http://localhost:5173/page', allowed), 'allowed');
  assert.equal(originMatch('https://user:pass@app.example.com', allowed), 'invalid');
  assert.equal(originMatch('file:///example', allowed), 'invalid');
});
