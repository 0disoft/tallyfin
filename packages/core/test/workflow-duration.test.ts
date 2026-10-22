import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyDurationCounts, workflowDuration, workflowDurationSlot } from '../src/workflow-duration.ts';
import { planIngest } from '../src/ingest.ts';
import type { IngestSnapshot } from '../src/ingest.ts';
import type { PreparedBatch, PreparedEvent } from '../src/types.ts';

test('duration ranges cover zero, every threshold neighbor and the inclusive 24h endpoint', () => {
  const edges = [1_000, 5_000, 30_000, 120_000, 600_000];
  assert.equal(workflowDurationSlot(0, 'success'), 0);
  edges.forEach((edge, index) => {
    assert.equal(workflowDurationSlot(edge - 1, 'success'), index * 2);
    assert.equal(workflowDurationSlot(edge, 'success'), (index + 1) * 2);
    assert.equal(workflowDurationSlot(edge + 1, 'failure'), (index + 1) * 2 + 1);
  });
  assert.equal(workflowDurationSlot(86_400_000, 'success'), 10);
  for (const value of [-1, 0.5, 86_400_001, NaN, Infinity]) assert.throws(() => workflowDurationSlot(value, 'success'));
});

test('measurement counts preserve incomplete history and failureless nulls without mutating inputs', () => {
  const counts = emptyDurationCounts(); counts[0] = 2; counts[3] = 1; Object.freeze(counts);
  const result = workflowDuration(counts, 5, 3, true);
  assert.equal(result.measuredAttempts, 3); assert.equal(result.unmeasuredAttempts, 5);
  assert.equal(result.buckets[1]!.failedAttempts, 1);
  const old = workflowDuration(emptyDurationCounts(), 4, 0, false);
  assert.equal(old.unmeasuredAttempts, 4); assert.ok(old.buckets.every(bucket => bucket.failedAttempts === null));
  for (const invalid of [[], Array(12).fill(-1), Array(12).fill(0.5), Array(12).fill(Number.MAX_SAFE_INTEGER)])
    assert.throws(() => workflowDuration(invalid, 1, 0, false));
  assert.throws(() => workflowDuration(counts, 1, 1, true));
});

const event = (phase: 'start' | 'success', time: number, id = phase): PreparedEvent => ({
  event: { eventId: id, name: phase, occurredAt: new Date(time).toISOString(), properties: {} },
  occurredAt: time, eventDate: '2026-10-23', dimensionKey: '[]', payloadHash: id,
  workflow: { id: 'task', phase, attemptId: 'attempt', startedAt: 1000, cohortDate: '2026-10-23', dimensionKey: '[]' },
});
const batch = (events: PreparedEvent[]): PreparedBatch => ({ projectId: 'test', schemaVersion: 1, source: 'browser', receivedAt: 6000, events });

test('out-of-order phases, duplicates and first terminal timestamp produce exactly one measurement', () => {
  const snapshot: IngestSnapshot = { receipts: [], attempts: [], newReceiptsToday: 0 };
  const terminal = planIngest(batch([event('success', 6000)]), snapshot, 100);
  assert.deepEqual(terminal.workflows, []);
  const frozen = Object.freeze(terminal.attempts[0]!);
  const started = planIngest(batch([event('start', 1000)]), { ...snapshot, attempts: [frozen] }, 100);
  assert.equal(started.workflows[0]!.durationCounts?.[4], 1); assert.equal(frozen.start_seen, 0);
  const repeat = planIngest(batch([event('success', 8000, 'another-terminal')]), { ...snapshot, attempts: started.attempts }, 100);
  assert.deepEqual(repeat.workflows, []); assert.equal(repeat.attempts[0]!.terminal_at, 6000);
  const together = planIngest(batch([event('start', 1000), event('success', 6000), event('success', 7000, 'duplicate')]), snapshot, 100);
  assert.equal(together.workflows[0]!.durationCounts?.reduce((sum, n) => sum + n, 0), 1);
});
