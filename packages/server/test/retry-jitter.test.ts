import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfinServer, type ServerPlatform } from '../src/index.ts';

test('jitter spreads idempotent delivery retries without violating Retry-After or total budget', async () => {
  for (const header of [null, '2']) for (const budget of [1500, 10000]) {
    let elapsed = 0, calls = 0;
    const waits: number[] = [], bodies: string[] = [];
    const host: ServerPlatform = {
      now: () => Date.parse('2026-10-23T00:00:00Z') + elapsed, monotonicNow: () => elapsed,
      random: () => 0.5, uuid: () => crypto.randomUUID(),
      wait: async ms => { waits.push(ms); elapsed += ms; },
      fetch: async (_url, init) => {
        calls++; bodies.push(String(init!.body));
        return calls < 3 ? new Response(null, { status: 503, headers: header ? { 'Retry-After': header } : {} })
          : Response.json({ accepted: 0, duplicates: 1 });
      },
    };
    const client = createTallyfinServer({ endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
      schema: { version: 1, events: { completed: {} } }, getToken: () => 'test-transport-marker', retryBudgetMs: budget }, host);
    const result = await client.send([client.createEvent('completed')]);
    if (budget === 1500) {
      assert.equal(result.status, 'unavailable'); assert.equal(calls, 1); assert.deepEqual(waits, []);
    } else {
      assert.equal(result.status, 'delivered'); assert.deepEqual(waits, header ? [2500, 2500] : [1500, 2500]);
      assert.equal(new Set(bodies).size, 1);
    }
  }
});
