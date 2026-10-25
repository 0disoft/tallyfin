import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UUID } from '@tallyfin/core';
import type { CollectionStore } from '@tallyfin/core';
import { createCollector } from '../src/handler.ts';
import { createWorker } from '../src/index.ts';
import { observationClock, latencyBucket, sampleRequestObservation } from '../src/request-observation.ts';
import type { RequestObservation } from '../src/request-observation.ts';
import { setup, registry, batch, now } from '../../../packages/storage-d1/test/helpers.ts';

function store(): CollectionStore {
  return { loadProject: async () => ({ ...registry.project, allowedOrigins: registry.allowedOrigins, limits: registry.limits }),
    admit: async () => true, loadRegistry: async () => registry,
    commit: async () => ({ accepted: 2, duplicates: 0 }), recordRejection: async () => {} };
}
function request(body = JSON.stringify(batch()), path = '/v1/projects/sembom/batches', method = 'POST') {
  return new Request(`https://collector.example.invalid${path}?private-query=never-log`, { method,
    headers: { Origin: registry.allowedOrigins[0]!, 'Content-Type': 'application/json', 'X-Private-Header': 'never-log-header',
      ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST' } : {}) },
    ...(method === 'POST' ? { body } : {}) });
}
test('all 256 random UUID prefix bins select four successes, every failure, and only the approved projection', () => {
  const base = crypto.randomUUID(); let successes = 0, failures = 0;
  for (let prefix = 0; prefix < 256; prefix++) {
    const entry: RequestObservation & { privateValue: string } = { requestId: prefix.toString(16).padStart(2, '0') + base.slice(2),
      operation: 'browser_collection', status: 200, code: 'ok', latencyBucket: 'lt_50ms', privateValue: 'never-log-field' };
    const sampled = sampleRequestObservation(entry);
    if (sampled) {
      successes++; assert.equal(sampled.samplingDenominator, 64); assert.match(sampled.requestId, UUID);
      assert.deepEqual(Object.keys(sampled).sort(), ['code', 'event', 'latencyBucket', 'operation', 'requestId', 'samplingDenominator', 'status']);
      assert.ok(!JSON.stringify(sampled).includes('never-log-field'));
    }
    for (const status of [400, 401, 403, 404, 409, 422, 429, 503]) {
      const failure = sampleRequestObservation({ ...entry, status, code: 'storage_unavailable' });
      assert.ok(failure); assert.equal(failure.samplingDenominator, 1); failures++;
    }
    assert.equal(Boolean(sampleRequestObservation({ ...entry, status: 204 })), prefix < 4);
  }
  assert.equal(successes, 4); assert.equal(failures, 256 * 8);
});
test('clock boundaries use fixed latency buckets and broken or reversed clocks remain unknown', () => {
  for (const [elapsed, expected] of [[0, 'lt_10ms'], [9.9, 'lt_10ms'], [10, 'lt_50ms'], [50, 'lt_250ms'],
    [250, 'lt_1000ms'], [1000, 'gte_1000ms']] as const) assert.equal(latencyBucket(100, 100 + elapsed), expected);
  assert.equal(latencyBucket(2, 1), 'unknown'); assert.equal(latencyBucket(null, 100), 'unknown');
  for (const value of [NaN, Infinity, -1]) assert.equal(observationClock(() => value), null);
  assert.equal(observationClock(() => { throw Error('never-log-clock'); }), null);
});
test('successful collection and preflight observe response readiness once without consuming or changing response bodies', async () => {
  const db = store(), observations: RequestObservation[] = []; let clock = 100;
  db.commit = async () => { clock = 137; return { accepted: 2, duplicates: 0 }; };
  const collector = createCollector(db, { now: () => now, monotonicNow: () => clock, observe: entry => observations.push(entry) });
  const result = await collector(request());
  assert.equal(result.bodyUsed, false); assert.deepEqual(await result.json(), { accepted: 2, duplicates: 0 });
  assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.equal(result.headers.get('Set-Cookie'), null);
  assert.equal(observations.length, 1); assert.match(observations[0]!.requestId, UUID);
  assert.deepEqual({ ...observations[0], requestId: null }, { requestId: null, operation: 'browser_collection',
    status: 200, code: 'ok', latencyBucket: 'lt_50ms' });
  assert.equal((await collector(request('', '/v1/projects/sembom/batches', 'OPTIONS'))).status, 204);
  assert.equal(observations.length, 2); assert.equal(observations[1]!.latencyBucket, 'lt_10ms');
  assert.equal(observations[1]!.status, 204);
  for (const value of ['sembom', 'private-query', 'never-log-header', registry.allowedOrigins[0]!, 'loan'])
    assert.ok(!JSON.stringify(observations).includes(value));
});
test('rejections keep their response request ID and code while callbacks, clock failure and background work cannot change them', async () => {
  const db = store(), observed: RequestObservation[] = [], background: Promise<void>[] = [];
  let release: (() => void) | undefined;
  db.recordRejection = async () => new Promise<void>(resolve => { release = resolve; });
  const collector = createCollector(db, { now: () => now, monotonicNow: () => NaN,
    observe: entry => observed.push(entry), waitUntil: task => background.push(task) });
  const response = await collector(request('{private-malformed-body'));
  assert.equal(response.status, 400); assert.equal(background.length, 1); assert.equal(observed.length, 1);
  const body = await response.json() as { error: { requestId: string; code: string } };
  assert.equal(observed[0]!.requestId, body.error.requestId); assert.equal(observed[0]!.code, body.error.code);
  assert.equal(observed[0]!.latencyBucket, 'unknown'); release!(); await Promise.all(background);
  const failed = createCollector(store(), { now: () => now, observe: () => { throw Error('never-log-sink'); },
    monotonicNow: () => { throw Error('never-log-clock'); }, log: () => { throw Error('never-log-old-sink'); } });
  const failure = await failed(request('{private-malformed-body'));
  assert.equal(failure.status, 400); assert.ok(!JSON.stringify(await failure.json()).includes('never-log'));
  assert.equal((await failed(request())).status, 200);
});
test('administrator, server and unknown endpoints use only fixed categories even when unauthorized or absent', async () => {
  const observations: RequestObservation[] = [];
  const collector = createCollector(store(), { now: () => now, observe: entry => observations.push(entry) });
  for (const [path, operation, status] of [['/v1/identity', 'administrator', 401],
    ['/v1/projects/private-id/summary', 'administrator', 401],
    ['/v1/projects/private-id/server-batches', 'server_collection', 401], ['/private-path', 'other', 404]] as const) {
    assert.equal((await collector(request('', path, 'GET'))).status, status);
    assert.equal(observations.at(-1)?.operation, operation);
  }
  assert.equal(observations.length, 4); assert.ok(!JSON.stringify(observations).includes('private'));
});
test('native Worker emits one response observation and one bounded diagnostic without private request or SQL data', async () => {
  const local = await setup();
  const previous = { log: console.log, warn: console.warn, error: console.error };
  const lines: { level: string; entry: Record<string, unknown> }[] = [];
  try {
    for (const level of ['log', 'warn', 'error'] as const) console[level] = value => lines.push({ level, entry: JSON.parse(value) });
    const worker = createWorker();
    const unauthorized = await worker.fetch(request('', '/v1/identity', 'GET'), { DB: local.db });
    assert.equal(unauthorized.status, 401); assert.equal(lines.length, 1); assert.equal(lines[0]!.level, 'warn');
    assert.equal(lines[0]!.entry.operation, 'administrator'); assert.equal(lines[0]!.entry.samplingDenominator, 1);
    await local.db.prepare('DROP TABLE project_schemas').run();
    const broken = await worker.fetch(request(), { DB: local.db });
    assert.equal(broken.status, 503); assert.equal(lines.length, 3); assert.equal(lines[1]!.level, 'error');
    assert.equal(lines[1]!.entry.event, 'collection_failure');
    assert.deepEqual(Object.keys(lines[1]!.entry).sort(), ['event', 'kind', 'requestId', 'stage']);
    assert.equal(lines[2]!.entry.code, 'storage_unavailable'); assert.equal(lines[2]!.entry.event, 'http_request');
    assert.equal(lines[1]!.entry.requestId, lines[2]!.entry.requestId);
    for (const value of ['sembom', 'projects', 'private-query', 'never-log-header', registry.allowedOrigins[0]!])
      assert.ok(!JSON.stringify(lines).includes(value));
  } finally { Object.assign(console, previous); await local.mf.dispose(); }
});
