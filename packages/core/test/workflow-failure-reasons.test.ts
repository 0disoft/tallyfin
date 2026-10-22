import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { emptyFailureReasonCounts, failureReasonDefinition, failureReasonDistribution, parseBatch, prepareBatch, planIngest, validateRegistry, validateSchemaDraft } from '../src/index.ts';

const registry = () => {
  const r = JSON.parse(readFileSync(new URL('../../../api/examples/registry.json', import.meta.url), 'utf8'));
  Object.assign(r.workflows[0], { failureEvent: 'validation_error', failureReasonProperty: 'error' }); return r;
};
test('failure reason configuration accepts only an enum on the failure event', () => {
  const r = registry(); assert.equal(validateSchemaDraft({ events: r.events, workflows: r.workflows }).valid, true);
  assert.deepEqual(failureReasonDefinition(r, r.workflows[0]), { property: 'error', values: ['range', 'required'] });
  for (const property of ['', 'missing', null, 1]) {
    const input = registry(); input.workflows[0].failureReasonProperty = property;
    assert.deepEqual(validateSchemaDraft({ events: input.events, workflows: input.workflows }).issues,
      [{ path: '/workflows/0/failureReasonProperty', code: 'invalid_reference' }]);
  }
  for (const mutate of [(r: any) => { r.workflows[0].failureEvent = null; },
    (r: any) => { r.events.find((e: any) => e.name === 'validation_error').properties.error = { type: 'boolean', required: false, purpose: 'fixed' }; }]) {
    const r = registry(); mutate(r); assert.equal(validateSchemaDraft({ events: r.events, workflows: r.workflows }).valid, false);
  }
});
test('missing, historical and measured failures remain distinct and invalid storage is rejected', () => {
  const counts = emptyFailureReasonCounts(); counts[0] = 2; counts[32] = 1; Object.freeze(counts);
  const definition = { property: 'error', values: ['range', 'required'] };
  assert.deepEqual(failureReasonDistribution(definition, counts, 5), { property: 'error', measuredFailures: 3,
    missingReasonFailures: 1, unmeasuredFailures: 2, buckets: [{ value: 'range', failedAttempts: 2 }, { value: 'required', failedAttempts: 0 }] });
  assert.equal(failureReasonDistribution(null, emptyFailureReasonCounts(), 5), null);
  for (const bad of [[], Array(33).fill(-1), Array(33).fill(0.5), Array(33).fill(Number.MAX_SAFE_INTEGER)])
    assert.throws(() => failureReasonDistribution(definition, bad, 5), { code: 'storage_unavailable' });
  const bad = emptyFailureReasonCounts(); bad[2] = 1;
  assert.throws(() => failureReasonDistribution(definition, bad, 5));
  assert.throws(() => failureReasonDistribution(null, counts, 5));
});
test('terminal-first failures keep first reason across new-ID duplicates and count only on confirmed start', async () => {
  const r = validateRegistry(registry());
  const raw = JSON.parse(readFileSync(new URL('../../../api/examples/browser-batch.json', import.meta.url), 'utf8'));
  raw.events[1].name = 'validation_error'; raw.events[1].properties.error = 'required';
  const at = Date.parse('2026-10-08T15:00:15Z');
  const prepared = await prepareBatch(parseBatch(JSON.stringify(raw)), r, at);
  assert.equal(prepared.events[1]!.workflow!.failureReasonSlot, 1);
  const snapshot = { receipts: [], attempts: [], newReceiptsToday: 0 };
  const terminal = planIngest({ ...prepared, events: [prepared.events[1]!] }, snapshot, 100);
  assert.equal(terminal.workflows.length, 0);
  Object.freeze(terminal.attempts[0]);
  const started = planIngest({ ...prepared, events: [prepared.events[0]!] }, { ...snapshot, attempts: terminal.attempts }, 100);
  assert.equal(started.workflows[0]!.failureReasonCounts?.[1], 1);
  const duplicate = structuredClone(prepared.events[1]!); duplicate.event.eventId = crypto.randomUUID(); duplicate.workflow!.failureReasonSlot = 0;
  const repeated = planIngest({ ...prepared, events: [duplicate] }, { ...snapshot, attempts: started.attempts }, 100);
  assert.equal(repeated.workflows.length, 0); assert.equal(repeated.attempts[0]!.failure_reason_slot, 1);
  delete raw.events[1].properties.error;
  assert.equal((await prepareBatch(parseBatch(JSON.stringify(raw)), r, at)).events[1]!.workflow!.failureReasonSlot, 32);
  const values = r.events.find(e => e.name === 'validation_error')!.properties.error!;
  if (values.type === 'enum') values.values.reverse();
  raw.events[1].properties.error = 'required';
  assert.equal((await prepareBatch(parseBatch(JSON.stringify(raw)), r, at)).events[1]!.workflow!.failureReasonSlot, 1);
});
