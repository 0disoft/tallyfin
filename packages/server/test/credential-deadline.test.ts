import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createTallyfinServer } from '../src/index.ts';
import type { ServerPlatform } from '../src/index.ts';

async function checkDeadlines(create: typeof createTallyfinServer) {
  for (const [timeout, budget, cost] of [[10, 1000, 10], [1000, 10, 10], [10, 1000, 11]] as const) {
    let elapsed = 0, tokens = 0, requests = 0, slow = true;
    let credentialSignal!: AbortSignal;
    const host: ServerPlatform = {
      now: () => Date.now(), monotonicNow: () => elapsed, uuid: () => crypto.randomUUID(),
      wait: async () => { assert.fail('Expired credential acquisition must not schedule retries'); },
      fetch: async () => { requests++; return Response.json({ accepted: 1, duplicates: 0 }); },
    };
    const client = create({
      endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
      schema: { version: 1, events: { job_finished: {} } },
      requestTimeoutMs: timeout, retryBudgetMs: budget,
      getToken: signal => {
        tokens++; credentialSignal = signal; if (slow) elapsed += cost;
        // Test-only transport marker; not a credential.
        return 'not-a-credential';
      },
    }, host);
    const event = client.createEvent('job_finished');
    assert.deepEqual(await client.send([event]), {
      status: 'unavailable', reason: 'authentication_unavailable', httpStatus: null, retryable: true, attempts: 0,
    });
    assert.equal(tokens, 1);
    assert.equal(requests, 0);
    assert.equal(credentialSignal.aborted, true);
    // A fresh call can still deliver the preserved event before its deadline.
    slow = false;
    assert.deepEqual(await client.send([event]), { status: 'delivered', accepted: 1, duplicates: 0, attempts: 1 });
    assert.equal(requests, 1);
  }
}

test('credential acquisition checks elapsed time before sending when the timeout callback has not run', async () => {
  await checkDeadlines(createTallyfinServer);
});

test('minified server SDK preserves the credential deadline and permits a later fresh send', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, minify: true, format: 'esm', platform: 'neutral', target: 'es2023' });
  const sdk = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'));
  await checkDeadlines(sdk.createTallyfinServer);
});

test('native fetch sends no HTTP request after synchronous credential work exceeds its deadline', async t => {
  let requests = 0, slow = true;
  const bodies: string[] = [];
  const server = createServer(async (request, response) => {
    requests++;
    let body = '';
    for await (const chunk of request) body += chunk;
    bodies.push(body);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ accepted: 1, duplicates: 0 }));
  });
  t.after(async () => {
    const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closing;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = createTallyfinServer({
    endpoint: `http://127.0.0.1:${address.port}/v1/projects/jobs/server-batches`, allowLocalHttp: true,
    schema: { version: 1, events: { job_finished: {} } }, requestTimeoutMs: 100, maxAttempts: 1,
    getToken: () => {
      if (slow) {
        const end = performance.now() + 120;
        while (performance.now() < end) { /* Simulate a synchronous provider blocking the event loop. */ }
      }
      // Test-only marker, accepted solely by this synthetic local HTTP server.
      return 'not-a-credential';
    },
  });
  const event = client.createEvent('job_finished');
  assert.deepEqual(await client.send([event]), {
    status: 'unavailable', reason: 'authentication_unavailable', httpStatus: null, retryable: true, attempts: 0,
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
  slow = false;
  assert.deepEqual(await client.send([event]), { status: 'delivered', accepted: 1, duplicates: 0, attempts: 1 });
  assert.equal(requests, 1);
  assert.equal(JSON.parse(bodies[0]!).events[0].eventId, event.eventId);
});
