import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { parseServerBatch } from '../../core/src/batch.ts';
import { createTallyfinServer } from '../src/index.ts';
import type { ServerEvent, ServerPlatform } from '../src/index.ts';

async function checkSlots(create: typeof createTallyfinServer) {
  const now = Date.parse('2026-10-12T00:00:00Z');
  let tokens = 0;
  const bodies: string[] = [];
  const host: ServerPlatform = {
    now: () => now, monotonicNow: () => 0, uuid: () => crypto.randomUUID(),
    wait: async () => { assert.fail('Invalid input must not schedule retries'); },
    fetch: async (_url, init) => {
      const body = String(init!.body);
      bodies.push(body);
      const batch = parseServerBatch(body);
      return Response.json({ accepted: batch.events.length, duplicates: 0 });
    },
  };
  const client = create({
    endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
    schema: { version: 1, events: { job_finished: {} } },
    // Test-only marker, used solely by the synthetic transport above.
    getToken: () => { tokens++; return 'not-a-credential'; },
  }, host);
  const event = () => client.createEvent('job_finished');
  const first = event(), second = event();
  const missingMiddle = [first, event(), second];
  delete missingMiddle[1];
  const inherited = new Array<ServerEvent>(1);
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: first }));
  const batches = [new Array<ServerEvent>(1), [, first], [first, , second],
    [first, ,], missingMiddle, inherited, [undefined], [first, null]];
  for (const batch of batches) {
    assert.deepEqual(await client.send(batch as ServerEvent[]), {
      status: 'rejected', reason: 'invalid_event', httpStatus: null, retryable: false, attempts: 0,
    });
    assert.equal(tokens, 0);
    assert.deepEqual(bodies, []);
  }
  assert.deepEqual(await client.send(Object.freeze([first, second])), {
    status: 'delivered', accepted: 2, duplicates: 0, attempts: 1,
  });
  assert.equal(tokens, 1);
  assert.equal(bodies.length, 1);
  assert.deepEqual(parseServerBatch(bodies[0]!).events.map(item => item.eventId), [first.eventId, second.eventId]);
}

test('server batches reject missing or inherited array slots before acquiring credentials or sending', async () => {
  await checkSlots(createTallyfinServer);
});

test('minified server SDK preserves all-slot validation and accepts a subsequent dense batch', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, minify: true, format: 'esm', platform: 'neutral', target: 'es2023' });
  const sdk = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'));
  await checkSlots(sdk.createTallyfinServer);
});
