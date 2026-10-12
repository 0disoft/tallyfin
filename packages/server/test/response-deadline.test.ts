import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createTallyfinServer } from '../src/index.ts';
import type { ServerPlatform } from '../src/index.ts';

async function verifyDeadlines(create: typeof createTallyfinServer) {
  for (const stage of ['headers', 'body'] as const) {
    for (const [timeout, budget, cost] of [[10, 1000, 10], [1000, 10, 10], [10, 1000, 11]] as const) {
      let elapsed = 0, slow = true, cancelled = false;
      const bodies: string[] = [];
      const signals: AbortSignal[] = [];
      const host: ServerPlatform = {
        now: () => Date.parse('2026-10-12T10:00:00Z'), monotonicNow: () => elapsed,
        uuid: () => crypto.randomUUID(), wait: async ms => { elapsed += ms; },
        fetch: async (_url, init) => {
          bodies.push(init!.body as string); signals.push(init!.signal!);
          if (slow && stage === 'headers') elapsed += cost;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (slow && stage === 'body') elapsed += cost;
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ accepted: slow ? 1 : 0, duplicates: slow ? 0 : 1 })));
              controller.close();
            },
            cancel() { cancelled = true; },
          }, { highWaterMark: 0 });
          return new Response(body, { headers: { 'Content-Type': 'application/json' } });
        },
      };
      const client = create({ endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
        schema: { version: 1, events: { job_done: {} } }, getToken: () => 'test-only-transport-value',
        maxAttempts: 1, requestTimeoutMs: timeout, retryBudgetMs: budget }, host);
      const event = client.createEvent('job_done');
      const late = await client.send([event]);
      assert.equal(late.status, 'unavailable', `${stage}: timeout=${timeout} budget=${budget} cost=${cost}`);
      if (late.status === 'delivered') throw Error('Unexpected delivered receipt');
      assert.equal(late.reason, 'transport_unavailable'); assert.equal(late.retryable, true);
      assert.equal(late.attempts, 1); assert.equal(signals[0]!.aborted, true);
      if (stage === 'headers') assert.equal(cancelled, true);
      // The collector may have committed before its late reply. A new send uses the same identity.
      slow = false;
      assert.deepEqual(await client.send([event]), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 1 });
      assert.equal(bodies[0], bodies[1]);
    }
  }
}

test('server SDK rejects late headers and receipts even before timeout callbacks can run', async () => {
  await verifyDeadlines(createTallyfinServer);
});

test('minified server SDK keeps deadline checks and exact replay identities', async () => {
  const output = await build({ entryPoints: ['packages/server/src/index.ts'], bundle: true, minify: true,
    format: 'esm', platform: 'node', target: 'node24', write: false });
  const bundled = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0]!.text).toString('base64'));
  await verifyDeadlines(bundled.createTallyfinServer);
});

test('server SDK retries a late receipt within budget using the exact batch', async () => {
  let elapsed = 0;
  const bodies: string[] = [], waits: number[] = [];
  const host: ServerPlatform = {
    now: () => Date.parse('2026-10-12T10:00:00Z'), monotonicNow: () => elapsed, uuid: () => crypto.randomUUID(),
    wait: async ms => { waits.push(ms); elapsed += ms; },
    fetch: async (_url, init) => {
      bodies.push(init!.body as string);
      const first = bodies.length === 1;
      return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
        elapsed += first ? 10 : 9;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ accepted: first ? 1 : 0, duplicates: first ? 0 : 1 })));
        controller.close();
      } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/json' } });
    },
  };
  const client = createTallyfinServer({ endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
    schema: { version: 1, events: { job_done: {} } }, getToken: () => 'test-only-transport-value',
    requestTimeoutMs: 10, retryBudgetMs: 5000, maxAttempts: 2 }, host);
  assert.deepEqual(await client.send([client.createEvent('job_done')]),
    { status: 'delivered', accepted: 0, duplicates: 1, attempts: 2 });
  assert.deepEqual(waits, [1000]); assert.equal(bodies[0], bodies[1]);
});

test('native HTTP receipts cannot prove delivery after synchronous response processing overruns the deadline', async t => {
  const bodies: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ accepted: 0, duplicates: 1 }));
  });
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No loopback port');
  for (const stage of ['headers', 'body'] as const) {
    let slow = true;
    const block = () => { if (!slow) return; const end = performance.now() + 100;
      while (performance.now() < end) { /* Simulate CPU work preventing timeout callbacks. */ } };
    const host: ServerPlatform = {
      now: () => Date.now(), monotonicNow: () => performance.now(), uuid: () => crypto.randomUUID(),
      wait: async () => { throw Error('No retry expected'); },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (stage === 'headers') { block(); return response; }
        return new Response(response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { block(); controller.enqueue(chunk); },
        })), { status: response.status, headers: response.headers });
      },
    };
    const client = createTallyfinServer({ endpoint: `http://127.0.0.1:${address.port}/v1/projects/jobs/server-batches`,
      allowLocalHttp: true, schema: { version: 1, events: { job_done: {} } }, getToken: () => 'test-only-loopback-value',
      maxAttempts: 1, requestTimeoutMs: 50, retryBudgetMs: 5000 }, host);
    const event = client.createEvent('job_done'), offset = bodies.length;
    const result = await client.send([event]);
    assert.equal(result.status, 'unavailable', stage);
    if (result.status === 'delivered') throw Error('Unexpected delivered receipt');
    assert.equal(result.reason, 'transport_unavailable'); assert.equal(result.attempts, 1);
    slow = false;
    assert.equal((await client.send([event])).status, 'delivered');
    assert.equal(bodies.length, offset + 2); assert.equal(bodies[offset], bodies[offset + 1]);
  }
});
