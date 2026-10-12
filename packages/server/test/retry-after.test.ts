import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createTallyfinServer } from '../src/index.ts';
import type { ServerPlatform } from '../src/index.ts';

const wall = Date.parse('2026-10-11T10:00:00Z');

async function checkDates(create: typeof createTallyfinServer) {
  for (const status of [429, 503]) for (const header of [
    'Mon, 01 Nov 2026 10:00:00 GMT', // Correct date, incorrect weekday.
    'Tue, 31 Nov 2026 10:00:00 GMT', // November has no day 31.
    'Mon, 30 Feb 2026 10:00:00 GMT', // Date.parse normalizes this into March.
    'Sun, 11 Oct 2026 24:00:00 GMT', // Date.parse normalizes this into the next day.
    '2026-11-01T10:00:00Z',
  ]) {
    const waits: number[] = [], bodies: string[] = [];
    let elapsed = 0, tokens = 0;
    const host: ServerPlatform = {
      now: () => wall + elapsed, monotonicNow: () => elapsed, uuid: () => crypto.randomUUID(),
      wait: async milliseconds => { waits.push(milliseconds); elapsed += milliseconds; },
      fetch: async (_url, init) => {
        bodies.push(String(init!.body));
        return bodies.length < 3 ? new Response(null, { status, headers: { 'Retry-After': header } })
          : Response.json({ accepted: 1, duplicates: 0 });
      },
    };
    const client = create({
      endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
      schema: { version: 1, events: { job_finished: {} } },
      // Test-only transport marker, not a credential.
      getToken: () => { tokens++; return 'not-a-credential'; },
    }, host);
    assert.deepEqual(await client.send([client.createEvent('job_finished')]),
      { status: 'delivered', accepted: 1, duplicates: 0, attempts: 3 }, header);
    assert.deepEqual(waits, [1000, 2000], header);
    assert.equal(tokens, 3);
    assert.ok(bodies.every(body => body === bodies[0]));
  }
}

test('malformed Retry-After dates retain bounded exponential backoff without normalizing dates', async () => {
  await checkDates(createTallyfinServer);
});

test('minified server SDK rejects normalized Retry-After dates with unchanged retry bodies', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, minify: true, format: 'esm', platform: 'neutral', target: 'es2023' });
  const sdk = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'));
  await checkDates(sdk.createTallyfinServer);
});

test('native fetch recovers from a malformed HTTP-date and preserves the exact event on retry', async t => {
  const bodies: string[] = [], waits: number[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    bodies.push(body);
    if (bodies.length === 1) {
      response.writeHead(503, { 'Retry-After': 'Mon, 01 Nov 2026 10:00:00 GMT' });
      response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ accepted: 0, duplicates: 1 }));
    }
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
  let elapsed = 0;
  const host: ServerPlatform = {
    now: () => wall + elapsed, monotonicNow: () => elapsed, uuid: () => crypto.randomUUID(), fetch,
    wait: async milliseconds => { waits.push(milliseconds); elapsed += milliseconds; },
  };
  const client = createTallyfinServer({
    endpoint: `http://127.0.0.1:${address.port}/v1/projects/jobs/server-batches`, allowLocalHttp: true,
    schema: { version: 1, events: { job_finished: {} } },
    // Test-only marker, accepted solely by this local synthetic HTTP server.
    getToken: () => 'not-a-credential',
  }, host);
  const event = client.createEvent('job_finished');
  assert.deepEqual(await client.send([event]), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 2 });
  assert.deepEqual(waits, [1000]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[1]!).events[0].eventId, event.eventId);
});
