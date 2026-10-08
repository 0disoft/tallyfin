import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfin } from '../src/index.ts';
import { deferred, endpoint, FakeBrowser, schema } from './helpers.ts';

test('20 events schedule a nonblocking batch; an incomplete batch waits 5 seconds', async () => {
  const host = new FakeBrowser(); const client = host.client();
  for (let count = 0; count < 20; count++) assert.equal(client.track('view', { tool: 'loan' }), true);
  assert.equal(host.calls.length, 0); assert.equal(client.pending, 20);
  await host.tick(0);
  assert.equal(host.calls.length, 1); assert.equal(JSON.parse(host.calls[0]!.body).events.length, 20);
  assert.equal(client.pending, 0);
  client.track('view', { tool: 'timer' }); await host.tick(4999); assert.equal(host.calls.length, 1);
  await host.tick(1); assert.equal(host.calls.length, 2); client.destroy();
});
test('the 40-event cap includes in-flight events and drops new starts without creating handles', async () => {
  const host = new FakeBrowser(); const response = deferred(); host.reply = () => response.promise;
  const client = host.client();
  for (let count = 0; count < 20; count++) client.track('view', { tool: 'loan' });
  await host.tick(0);
  for (let count = 0; count < 20; count++) client.track('view', { tool: 'loan' });
  assert.equal(client.pending, 40); assert.equal(client.track('view', { tool: 'loan' }), false);
  assert.equal(client.start('conversion', { tool: 'loan' }), undefined);
  response.resolve({ status: 200, retryAfter: null }); await host.tick(5000);
  assert.equal(client.pending, 0); client.destroy();
});
test('429 and 503 honor Retry-After, retain byte-identical bodies and stop after two retries', async () => {
  const host = new FakeBrowser();
  host.reply = index => Promise.resolve({ status: index === 0 ? 429 : 503, retryAfter: index === 0 ? '60' : null });
  const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
  await host.tick(59999); assert.equal(host.calls.length, 1);
  await host.tick(1); assert.equal(host.calls.length, 2);
  await host.tick(2000); assert.equal(host.calls.length, 3); assert.equal(client.pending, 0);
  assert.ok(host.calls.every(call => call.body === host.calls[0]!.body));
  await host.tick(600000); assert.equal(host.calls.length, 3); client.destroy();
});
test('network rejection is retried; validation/conflict/status errors are dropped without retry', async () => {
  for (const status of [400, 403, 404, 409, 413, 415, 422, 500]) {
    const host = new FakeBrowser(); host.reply = () => Promise.resolve({ status, retryAfter: null });
    const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(20000);
    assert.equal(host.calls.length, 1); assert.equal(client.pending, 0); client.destroy();
  }
  const host = new FakeBrowser(); host.reply = () => Promise.reject(Error('network'));
  const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(4000);
  assert.equal(host.calls.length, 3); assert.equal(client.pending, 0); client.destroy();
});
test('daily Retry-After beyond 10 minutes drops the batch instead of scheduling it', async () => {
  const host = new FakeBrowser(); host.reply = () => Promise.resolve({ status: 429, retryAfter: '86400' });
  const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
  assert.equal(client.pending, 0); assert.equal(host.timers.size, 0); client.destroy();
});
test('suspended retry timers cannot send after the 10-minute deadline', async () => {
  const host = new FakeBrowser(); host.reply = () => Promise.resolve({ status: 503, retryAfter: '1' });
  const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
  host.time += 600001; await host.tick(0);
  assert.equal(host.calls.length, 1); assert.equal(client.pending, 0); client.destroy();
});
test('timeout aborts a hung request; its late response cannot settle a newer retry', async () => {
  const host = new FakeBrowser(); const first = deferred(); const second = deferred();
  host.reply = index => index === 0 ? first.promise : second.promise;
  const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(10000);
  assert.equal(host.calls[0]!.signal.aborted, true);
  await host.tick(1000); assert.equal(host.calls.length, 2);
  first.resolve({ status: 200, retryAfter: null }); await host.tick(0); assert.equal(client.pending, 1);
  second.resolve({ status: 200, retryAfter: null }); await host.tick(0); assert.equal(client.pending, 0); client.destroy();
});
test('destroy removes listeners/timers, aborts I/O, drops memory and ignores late replies', async () => {
  const host = new FakeBrowser(); const response = deferred(); host.reply = () => response.promise;
  const client = host.client(); const attempt = client.start('conversion', { tool: 'loan' })!;
  client.flush(); await host.tick(0); client.destroy(); client.destroy();
  assert.equal(host.listeners.size, 0); assert.equal(host.timers.size, 0);
  assert.equal(host.calls[0]!.signal.aborted, true); assert.equal(client.pending, 0);
  response.resolve({ status: 503, retryAfter: '1' }); await host.tick(20000);
  assert.equal(host.calls.length, 1); assert.equal(attempt.succeed(), false); assert.equal(client.track('view', { tool: 'loan' }), false);
});
test('workflow start and terminal share identity/time/dimensions; only one terminal is queued', async () => {
  const host = new FakeBrowser(); const client = host.client();
  const properties = { tool: 'loan' }; const attempt = client.start('conversion', properties)!;
  properties.tool = 'timer'; host.time += 1000;
  assert.equal(attempt.succeed({ tool: 'timer' }), false); assert.equal(attempt.succeed(), true);
  assert.equal(attempt.fail(), false); assert.equal(attempt.succeed(), false);
  client.flush(); await host.tick(0);
  const events = JSON.parse(host.calls[0]!.body).events;
  assert.deepEqual(events[0].attempt, events[1].attempt);
  assert.equal(events[0].occurredAt, events[0].attempt.startedAt);
  assert.equal(events[1].properties.tool, 'loan');
  assert.notEqual(events[0].eventId, events[1].eventId);
  assert.equal(client.track('started', { tool: 'loan' }), false); client.destroy();
});
test('a full buffer can reject a terminal without consuming the handle', async () => {
  const host = new FakeBrowser(); const response = deferred(); host.reply = () => response.promise;
  const client = host.client(); const attempt = client.start('conversion', { tool: 'loan' })!;
  for (let count = 0; count < 39; count++) client.track('view', { tool: 'loan' });
  assert.equal(attempt.succeed(), false); await host.tick(0);
  response.resolve({ status: 200, retryAfter: null }); await host.tick(0);
  assert.equal(attempt.succeed(), true); client.destroy();
});
test('canceled or expired handles and workflows without failure cannot emit a failure', async () => {
  const host = new FakeBrowser(); const copy = structuredClone(schema); delete copy.workflows.conversion!.failure;
  const client = host.client(copy); const canceled = client.start('conversion', { tool: 'loan' })!;
  assert.equal(canceled.fail(), false); canceled.cancel(); assert.equal(canceled.succeed(), false);
  const expired = client.start('conversion', { tool: 'loan' })!;
  host.time += 86400001; assert.equal(expired.succeed(), false); client.destroy();
});
test('hidden tab uses Beacon for unsent batches; false/throw falls back to keepalive transport', async () => {
  for (const beacon of ['true', 'false', 'throw']) {
    const host = new FakeBrowser(); host.beaconResult = beacon === 'true';
    if (beacon === 'throw') host.beacon = () => { throw Error('beacon'); };
    const client = host.client(); client.track('view', { tool: 'loan' }); host.hidden();
    await host.tick(0);
    assert.equal(client.pending, 0); assert.equal(host.calls.length, beacon === 'true' ? 0 : 1); client.destroy();
  }
});
test('hidden tab cannot resend an active batch or bypass Retry-After', async () => {
  const host = new FakeBrowser(); host.beaconResult = true;
  host.reply = () => Promise.resolve({ status: 429, retryAfter: '60' });
  const client = host.client(); client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
  client.track('view', { tool: 'timer' }); host.hidden(); await host.tick(0);
  assert.equal(host.calls.length, 1); assert.equal(host.beacons.length, 0); assert.equal(client.pending, 2);
  await host.tick(60000); assert.equal(host.calls.length, 2); client.destroy();
});
test('hidden callback starts both pending keepalive batches immediately when Beacon is unavailable', async () => {
  const host = new FakeBrowser(); const response = deferred(); host.reply = () => response.promise;
  host.beacon = undefined as any;
  const client = host.client();
  for (let count = 0; count < 40; count++) client.track('view', { tool: 'loan' });
  host.hidden(); assert.equal(host.calls.length, 2); assert.equal(client.pending, 40);
  for (const call of host.calls) {
    assert.equal(JSON.parse(call.body).events.length, 20);
    assert.ok(new TextEncoder().encode(call.body).length <= 16384);
  }
  response.resolve({ status: 200, retryAfter: null }); await host.tick(0);
  assert.equal(client.pending, 0); client.destroy();
});
test('unknown/free text/nested properties and wrong types are rejected before buffering', () => {
  const host = new FakeBrowser(); const client = host.client();
  for (const [name, properties] of [
    ['unknown', { tool: 'loan' }], ['view', { tool: 'private_file_name' }], ['view', { tool: 'loan', url: 'https://private.invalid' }],
    ['view', { tool: { name: 'loan' } }], ['view', {}], ['bucket', { flag: 1 }], ['bucket', { flag: true, size: 4 }],
    ['bucket', { flag: true, size: 1.5 }], ['constructor', {}],
  ] as const) assert.equal(client.track(name, properties as any), false);
  assert.equal(client.track('bucket', { flag: false, size: 0 }), false);
  assert.equal(client.track('bucket', { flag: false, size: 1 }), true);
  assert.equal(client.pending, 1); client.destroy();
});
test('properties are snapshotted once; getters and toJSON cannot replace validated values', async () => {
  const host = new FakeBrowser(); const client = host.client(); let reads = 0;
  const properties = { get tool() { return ++reads === 1 ? 'loan' : 'private'; } };
  Object.defineProperty(properties, 'toJSON', { value: () => ({ private: 'secret' }), enumerable: false });
  assert.equal(client.track('view', properties), true); client.flush(); await host.tick(0);
  const body = host.calls[0]!.body;
  assert.ok(!body.includes('private')); assert.ok(!body.includes('secret')); assert.equal(reads, 1);
  assert.equal(JSON.parse(body).events[0].properties.tool, 'loan'); client.destroy();
});
test('crypto failure and malformed IDs do not enqueue or fall back to weak randomness', () => {
  for (const uuid of [() => { throw Error('crypto'); }, () => 'visitor', () => 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']) {
    const host = new FakeBrowser(); host.uuid = uuid;
    const client = host.client(); assert.equal(client.track('view', { tool: 'loan' }), false);
    assert.equal(client.start('conversion', { tool: 'loan' }), undefined); assert.equal(client.pending, 0); client.destroy();
  }
});
test('SSR, disabled collection and invalid configuration are inert without listeners', () => {
  assert.equal(createTallyfin({ endpoint, schema }).track('view', { tool: 'loan' }), false);
  const host = new FakeBrowser();
  for (const endpoint of ['http://collector.example.invalid/v1/projects/example/batches', 'https://collector.example.invalid/v1/projects/example/batches?token=private', 'https://user:password@collector.example.invalid/v1/projects/example/batches', 'https://collector.example.invalid/other'])
    assert.equal(createTallyfin({ endpoint, schema }, host).track('view', { tool: 'loan' }), false);
  assert.equal(createTallyfin({ endpoint, schema, enabled: false }, host).pending, 0);
  const copy = structuredClone(schema); copy.events.view!.tool = ['enum', true, ['free text']];
  assert.equal(host.client(copy).track('view', { tool: 'loan' }), false);
  assert.equal(host.listeners.size, 0); assert.equal(host.timers.size, 0);
});
test('native browser adapter omits credentials/referrer and releases its visibility listener', async () => {
  const originals = new Map(['document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new EventTarget(); let detach = 0;
  const remove = document.removeEventListener.bind(document);
  document.removeEventListener = (...args) => { detach++; remove(...args); };
  let sent: RequestInit | undefined;
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  Object.defineProperty(globalThis, 'fetch', { value: async (_url: string, options: RequestInit) => { sent = options; return new Response('{}'); }, configurable: true });
  const client = createTallyfin({ endpoint, schema });
  try {
    assert.equal(client.track('view', { tool: 'loan' }), true); assert.equal(client.flush(), undefined);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sent?.credentials, 'omit'); assert.equal(sent?.referrerPolicy, 'no-referrer');
    assert.equal(sent?.keepalive, true); assert.equal(sent?.cache, 'no-store');
    assert.equal((sent?.headers as Record<string, string>)['Content-Type'], 'text/plain;charset=utf-8');
  } finally {
    client.destroy();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
  assert.equal(detach, 1);
});
