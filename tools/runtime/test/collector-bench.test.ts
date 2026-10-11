import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pool, latency } from '../collector-bench.ts';

test('benchmark pool caps in-flight work, preserves result order and drains failed work before returning', async () => {
  let inFlight = 0, maximum = 0;
  const output = await pool([0, 1, 2, 3, 4], 2, async value => {
    maximum = Math.max(maximum, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, value % 2 ? 1 : 10));
    inFlight--; return value * 2;
  });
  assert.deepEqual(output, [0, 2, 4, 6, 8]); assert.equal(maximum, 2); assert.equal(inFlight, 0);
  const started: number[] = []; let drained = false;
  await assert.rejects(pool([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) { await new Promise(resolve => setTimeout(resolve, 1)); throw Error('failed-request'); }
    await new Promise(resolve => setTimeout(resolve, 10)); drained = true;
  }), /failed-request/);
  assert.deepEqual(started, [0, 1]); assert.equal(drained, true);
  for (const invalid of [0, 17, 1.5, NaN]) await assert.rejects(pool([1], invalid, async value => value));
});

test('benchmark latency keeps raw measurements and rejects empty or invalid samples', () => {
  const samples = [9, 1, 3, 7];
  assert.deepEqual(latency(samples), { samples: 4, p50Ms: 3, p95Ms: 9, maxMs: 9 });
  assert.deepEqual(samples, [9, 1, 3, 7]);
  for (const invalid of [[], [NaN], [Infinity], [-1]]) assert.throws(() => latency(invalid));
});
