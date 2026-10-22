import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfin } from '../src/index.ts';
import { endpoint, schema } from './helpers.ts';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('native adapter releases a batch after headers even if body cancellation stalls or rejects', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originals = new Map(['document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const clients: ReturnType<typeof createTallyfin>[] = [];
  Object.defineProperty(globalThis, 'document', { value: new EventTarget(), configurable: true });
  t.after(() => {
    clients.forEach(client => client.destroy());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  for (const status of [200, 401, 403, 422]) for (const cleanup of ['stall', 'reject', 'throw']) {
    let calls = 0, cancellations = 0;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() {
        cancellations++;
        if (cleanup === 'throw') throw Error('private cleanup detail');
        return cleanup === 'stall' ? new Promise(() => {}) : Promise.reject(Error('private cleanup detail'));
      } }), { status });
    } });
    const client = createTallyfin({ endpoint, schema }); clients.push(client);
    assert.equal(client.track('view', { tool: 'loan' }), true); client.flush();
    t.mock.timers.tick(0); await turn();
    assert.equal(client.pending, 0, `HTTP ${status} must not wait for cleanup`);
    assert.equal(cancellations, 1);
    t.mock.timers.tick(40000); await turn();
    assert.equal(calls, 1); client.destroy();
  }
});

test('native adapter refuses redirect forwarding and drops opaque redirect responses without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.5);
  const originals = new Map(['document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let client: ReturnType<typeof createTallyfin> | undefined;
  Object.defineProperty(globalThis, 'document', { value: new EventTarget(), configurable: true });
  t.after(() => {
    client?.destroy();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  for (const opaque of [false, true]) {
    let calls = 0, options: RequestInit | undefined;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: string, init: RequestInit) => {
      calls++; options = init;
      const response = opaque ? Response.error() : new Response(null, { status: 307 });
      if (opaque) Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
      return response;
    } });
    client = createTallyfin({ endpoint, schema });
    assert.equal(client.track('view', { tool: 'loan' }), true); client.flush();
    t.mock.timers.tick(0); await turn();
    assert.equal(options?.redirect, 'manual');
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.referrerPolicy, 'no-referrer');
    assert.equal(new Request(endpoint, options).mode, 'cors');
    assert.equal(client.pending, 0);
    t.mock.timers.tick(40000); await turn();
    assert.equal(calls, 1); client.destroy();
  }
  let calls = 0;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => {
    calls++; throw new TypeError('synthetic network failure');
  } });
  client = createTallyfin({ endpoint, schema }); client.track('view', { tool: 'loan' }); client.flush();
  t.mock.timers.tick(0); await turn(); assert.equal(client.pending, 1);
  t.mock.timers.tick(1499); await turn(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await turn(); assert.equal(calls, 2);
  t.mock.timers.tick(2499); await turn(); assert.equal(calls, 2);
  t.mock.timers.tick(1); await turn();
  assert.equal(calls, 3); assert.equal(client.pending, 0); client.destroy();
});
