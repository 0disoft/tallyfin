import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DAY, planIngest, prepareFunnelObservation, validateRegistry } from '../src/index.ts';
import type { IngestSnapshot, PreparedBatch, PreparedServerBatch } from '../src/index.ts';

const registry = validateRegistry(JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8')));
const definition = registry.funnels![0]!, start = Date.parse('2026-10-11T14:59:59Z'), now = start + 10_000;
const runId = crypto.randomUUID();
async function prepare(index: number, id = crypto.randomUUID(), properties = { kind: 'pdf' }) {
  const step = definition.steps[index]!;
  const observation = await prepareFunnelObservation({ eventId: id, name: step.eventName,
    occurredAt: new Date(start + index * 1000).toISOString(), properties,
    funnel: { funnelId: definition.id, runId, startedAt: new Date(start).toISOString() } }, registry, definition, step.source, now);
  return { event: observation.event, occurredAt: observation.occurredAt, eventDate: observation.eventDate,
    dimensionKey: observation.eventDimensionKey, payloadHash: observation.payloadHash, funnel: observation };
}
const batch = (source: 'browser' | 'server', events: Awaited<ReturnType<typeof prepare>>[]) => ({
  projectId: registry.project.id, schemaVersion: 1, source, receivedAt: now, events,
}) as PreparedBatch | PreparedServerBatch;
const empty = (): IngestSnapshot => ({ receipts: [], attempts: [], newReceiptsToday: 0, funnelRuns: [] });

test('shared ingest planning connects browser/server stages after receipt deduplication without skipping missing steps', async () => {
  const last = await prepare(3), early = planIngest(batch('server', [last]), empty(), 10);
  assert.equal(early.accepted, 1); assert.deepEqual(early.funnels, []);
  const firstTwo = await Promise.all([0, 1].map(index => prepare(index)));
  const browser = planIngest(batch('browser', firstTwo), { ...empty(), funnelRuns: early.funnelRuns, newReceiptsToday: 1 }, 10);
  assert.deepEqual(browser.funnels.map(delta => delta.stepIndex), [0, 1]);
  const third = await prepare(2);
  const final = planIngest(batch('server', [third]), { ...empty(), funnelRuns: browser.funnelRuns, newReceiptsToday: 3 }, 10);
  assert.deepEqual(final.funnels.map(delta => delta.stepIndex), [2, 3]);
  assert.ok(final.funnels.every(delta => delta.cohortDate === '2026-10-11'));
  assert.deepEqual(final.attempts, []); assert.deepEqual(final.workflows, []);
  const snapshot = { ...empty(), receipts: final.receipts, funnelRuns: final.funnelRuns, newReceiptsToday: 4 };
  const retry = planIngest(batch('server', [third]), snapshot, 4);
  assert.equal(retry.duplicates, 1); assert.deepEqual(retry.receipts, []); assert.deepEqual(retry.funnels, []);
  const logicalRetry = planIngest(batch('server', [await prepare(2)]), snapshot, 10);
  assert.equal(logicalRetry.duplicates, 1); assert.equal(logicalRetry.receipts.length, 1);
  assert.deepEqual(logicalRetry.events, []); assert.deepEqual(logicalRetry.funnels, []);
  assert.equal(logicalRetry.funnelRuns[0]!.expiresAt, start + 3 * DAY);
});

test('quota, receipt and run conflicts leave the shared snapshot unchanged and never yield partial plans', async () => {
  const first = await prepare(0), accepted = planIngest(batch('browser', [first]), empty(), 10);
  const snapshot = { receipts: accepted.receipts, attempts: [], newReceiptsToday: 1, funnelRuns: accepted.funnelRuns };
  const original = structuredClone(snapshot), second = await prepare(1);
  assert.throws(() => planIngest(batch('browser', [second]), snapshot, 1), { code: 'quota_exceeded' });
  const conflictingReceipt = { ...second, event: { ...second.event, eventId: first.event.eventId } };
  assert.throws(() => planIngest(batch('browser', [conflictingReceipt]), snapshot, 10), { code: 'event_conflict' });
  const wrongDimension = await prepare(1, crypto.randomUUID(), { kind: 'image' });
  assert.throws(() => planIngest(batch('browser', [wrongDimension]), snapshot, 10), { code: 'attempt_conflict' });
  assert.deepEqual(snapshot, original);
});
