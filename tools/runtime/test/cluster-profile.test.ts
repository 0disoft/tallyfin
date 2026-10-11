import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterProfile } from '../cluster-bench.ts';

test('fixed short and soak profiles fit the scheduler job limit and preserve offered pacing and duplicate accounting', () => {
  const short = clusterProfile('short'), soak = clusterProfile('soak');
  assert.equal(short.windowMs, 120000); assert.equal(short.expectedAccepted, 3600); assert.equal(short.expectedRuns, 600);
  assert.equal(soak.windowMs, 600000); assert.equal(soak.expectedAccepted, 18000); assert.equal(soak.expectedDuplicates, 36000);
  assert.equal(soak.expectedRuns, 3000); assert.equal(soak.cleanupInvocations, 120); assert.equal(soak.timeoutMs, 660000);
  for (const plan of [short, soak]) {
    assert.ok(plan.waves * 15 + plan.cleanupInvocations <= 10000);
    assert.equal(plan.waves * 15 / (plan.windowMs / 1000), 7.5);
  }
  assert.throws(() => clusterProfile('remote' as never), /invalid-cluster-profile/);
});
