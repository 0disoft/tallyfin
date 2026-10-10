import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionError, DAY, funnelCounts, parseBatch, parseServerBatch, planFunnelProgress,
  prepareFunnelObservation, SchemaDefinitionError, validateFunnelDefinitions, validateRegistry } from '../src/index.ts';
import type { FunnelDefinition, FunnelEvent, FunnelRunState, Registry } from '../src/index.ts';

const startedAt = '2026-10-11T14:59:59.000Z';
const start = Date.parse(startedAt), receivedAt = start + 10_000;
const runId = 'b212284f-57a6-41e4-a41f-10c6d2db76c7';
const definition: FunnelDefinition = { id: 'conversion', label: 'Conversion', dimensions: ['kind'], steps: [
  { eventName: 'file_selected', source: 'browser' }, { eventName: 'upload_finished', source: 'browser' },
  { eventName: 'job_started', source: 'server' }, { eventName: 'job_finished', source: 'server' },
] };
const registry: Registry = validateRegistry({ project: { id: 'modufile', name: 'ModuFile', status: 'active', timeZone: 'Asia/Seoul' },
  schemaVersion: 1, schemaStatus: 'active', allowedOrigins: ['https://example.invalid'],
  limits: { requestsPerMinute: 60, newReceiptsPerUtcDay: 1000 }, workflows: [],
  events: definition.steps.map(step => ({ name: step.eventName, label: step.eventName, source: step.source,
    properties: { kind: { type: 'enum', required: true, purpose: 'Reviewed format bucket', values: ['pdf', 'image'] },
      retried: { type: 'boolean', required: false, purpose: 'Retry flag' } } })),
});
const event = (stepIndex: number, offset = stepIndex * 1000): FunnelEvent => ({
  eventId: `fd57ec8c-27e4-4b58-a3e0-28c02c09900${stepIndex}`, name: definition.steps[stepIndex]!.eventName,
  occurredAt: new Date(start + offset).toISOString(), properties: { kind: 'pdf' }, funnel: { funnelId: definition.id, runId, startedAt },
});
const prepare = (index: number, input: unknown = event(index), r = registry, at = receivedAt) =>
  prepareFunnelObservation(input, r, definition, definition.steps[index]!.source, at);
const code = (expected: string) => (error: unknown) => error instanceof CollectionError && error.code === expected;

test('funnel definitions bind source and identical required dimension domains within limits', () => {
  validateFunnelDefinitions([definition], registry.events);
  const reordered = structuredClone(registry.events); reordered[1]!.properties.kind = {
    type: 'enum', required: true, purpose: 'Reviewed bucket', values: ['image', 'pdf'],
  };
  validateFunnelDefinitions([definition], reordered);
  for (const mutate of [
    (d: any) => { d.steps[2].source = 'browser'; }, (d: any) => { d.steps[2].eventName = 'missing'; },
    (d: any) => { d.steps.push(d.steps[0]); }, (d: any) => { d.steps = d.steps.slice(0, 1); },
    (d: any) => { d.steps = Array(11).fill(d.steps[0]); }, (d: any) => { d.dimensions.push('kind'); },
    (d: any) => { d.visitorId = 'forbidden'; }, (d: any) => { d.steps[0].url = 'forbidden'; },
    (d: any) => { d.dimensions = ['retried']; },
  ]) {
    const input = structuredClone(definition); mutate(input);
    assert.throws(() => validateFunnelDefinitions([input], registry.events), SchemaDefinitionError);
  }
  const changed = structuredClone(registry.events);
  changed[3]!.properties.kind = { type: 'enum', required: true, purpose: 'bucket', values: ['other'] };
  assert.throws(() => validateFunnelDefinitions([definition], changed), SchemaDefinitionError);
  assert.throws(() => validateFunnelDefinitions([definition, definition], registry.events), SchemaDefinitionError);
  validateFunnelDefinitions([], registry.events);
});

test('preparation uses registered property rules and canonical timestamps; current endpoints stay closed', async () => {
  const input = event(0);
  const first = await prepare(0, input);
  const spelling = structuredClone(input); spelling.occurredAt = startedAt.replace('.000Z', 'Z'); spelling.funnel.startedAt = spelling.occurredAt;
  assert.equal((await prepare(0, spelling)).payloadHash, first.payloadHash);
  assert.equal(first.cohortDate, '2026-10-11'); assert.equal(first.eventDate, '2026-10-11');
  const end = await prepare(3);
  assert.equal(end.cohortDate, '2026-10-11'); assert.equal(end.eventDate, '2026-10-12');
  const otherRun = event(0); otherRun.funnel.runId = crypto.randomUUID();
  assert.notEqual((await prepare(0, otherRun)).payloadHash, first.payloadHash);
  assert.throws(() => parseBatch(JSON.stringify({ schemaVersion: 1, source: 'browser', events: [input] })), code('invalid_event'));
  assert.throws(() => parseServerBatch(JSON.stringify({ schemaVersion: 1, source: 'server', events: [event(3)] })), code('invalid_event'));
  for (const mutate of [
    (e: any) => { e.properties.kind = 'private text'; }, (e: any) => { delete e.properties.kind; },
    (e: any) => { e.properties.user_id = 'private'; }, (e: any) => { e.properties.toString = 'private'; },
    (e: any) => { e.funnel.runId = 'visitor-id'; }, (e: any) => { e.funnel.funnelId = 'other'; },
    (e: any) => { e.funnel.token = 'forbidden'; }, (e: any) => { e.attempt = {}; },
    (e: any) => { e.funnel.startedAt = new Date(start - 1).toISOString(); },
  ]) {
    const value = event(0); mutate(value);
    await assert.rejects(prepare(0, value), code('invalid_event'));
  }
  await assert.rejects(prepareFunnelObservation(event(3), registry, definition, 'browser', receivedAt), code('invalid_event'));
  await assert.rejects(prepare(0, event(0), { ...registry, project: { ...registry.project, status: 'paused' } }), code('project_unavailable'));
  await assert.rejects(prepare(0, event(0), { ...registry, schemaStatus: 'retired' }), code('unknown_schema'));
});

test('funnel stages allow the exact 24-hour run boundary and reject late or reversed timestamps', async () => {
  await prepare(3, event(3, DAY), registry, start + DAY);
  await assert.rejects(prepare(3, event(3, DAY + 1), registry, start + DAY + 1), code('invalid_event'));
  await assert.rejects(prepare(1, event(1, -1)), code('invalid_event'));
  await assert.rejects(prepare(1, event(1), registry, start + DAY + 1001), code('invalid_event'));
  await assert.rejects(prepare(3, event(3), registry, start - 300_001), code('invalid_event'));
});

test('all arrival orders count each browser/server stage exactly once in the start-day cohort', async () => {
  const observations = await Promise.all([0, 1, 2, 3].map(index => prepare(index)));
  const permutations = (values: number[]): number[][] => values.length === 0 ? [[]] :
    values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map(rest => [value, ...rest]));
  for (const order of permutations([0, 1, 2, 3])) {
    let state: FunnelRunState | null = null; const totals = [0, 0, 0, 0];
    for (const index of order) {
      const before = structuredClone(state); const result = planFunnelProgress(observations[index]!, state);
      assert.deepEqual(state, before); state = result.state;
      for (const delta of result.deltas) {
        assert.equal(delta.cohortDate, '2026-10-11'); totals[delta.stepIndex]! += delta.reachedCount;
      }
    }
    assert.deepEqual(totals, [1, 1, 1, 1]);
    const repeat = planFunnelProgress(observations[2]!, state);
    assert.equal(repeat.duplicate, true); assert.deepEqual(repeat.deltas, []);
  }
});

test('an absent start or intermediate stage cannot manufacture a conversion', async () => {
  const fourth = planFunnelProgress(await prepare(3), null); assert.deepEqual(fourth.deltas, []);
  const first = planFunnelProgress(await prepare(0), fourth.state); assert.deepEqual(first.deltas.map(d => d.stepIndex), [0]);
  const third = planFunnelProgress(await prepare(2), first.state); assert.deepEqual(third.deltas, []);
  const second = planFunnelProgress(await prepare(1), third.state); assert.deepEqual(second.deltas.map(d => d.stepIndex), [1, 2, 3]);
  const sameInstant = await Promise.all([0, 1, 2, 3].map(index => prepare(index, event(index, 0))));
  let state: FunnelRunState | null = null;
  for (const observation of sameInstant) state = planFunnelProgress(observation, state).state;
  assert.deepEqual(state!.stepTimes, [start, start, start, start]);
});

test('conflicts isolate tenant, version, run definition, dimensions and timestamps without mutating a snapshot', async () => {
  const first = await prepare(0); const state = planFunnelProgress(first, null).state; const before = structuredClone(state);
  for (const altered of [
    { ...first, projectId: 'other' }, { ...first, schemaVersion: 2 }, { ...first, stepCount: 3 },
    { ...first, dimensionKey: '[]' }, { ...first, startedAt: start + 1 },
    { ...first, event: { ...first.event, funnel: { ...first.event.funnel, runId: crypto.randomUUID() } } },
  ]) assert.throws(() => planFunnelProgress(altered, state), code('attempt_conflict'));
  const staged = planFunnelProgress(await prepare(2), state).state;
  assert.throws(() => planFunnelProgress({ ...first, stepIndex: 1, occurredAt: start + 3000 }, staged), code('attempt_conflict'));
  assert.throws(() => planFunnelProgress({ ...first, occurredAt: start + 1 }, state), code('attempt_conflict'));
  assert.throws(() => planFunnelProgress(first, { ...state, stepTimes: [start, start - 1, null, null] }), code('storage_unavailable'));
  assert.deepEqual(state, before);
});

test('expiration uses the original start rather than latest receipt and ignores expired linkage', async () => {
  const first = await prepare(0); const state = planFunnelProgress(first, null).state;
  const next = planFunnelProgress(await prepare(1), state);
  assert.equal(next.state.expiresAt, start + 3 * DAY);
  const newStart = start + 3 * DAY;
  const later = event(0); later.occurredAt = new Date(newStart).toISOString(); later.funnel.startedAt = later.occurredAt;
  const observation = await prepare(0, later, registry, newStart);
  const reset = planFunnelProgress(observation, state);
  assert.equal(reset.state.startedAt, newStart); assert.deepEqual(reset.state.stepTimes, [newStart, null, null, null]);
  assert.deepEqual(reset.deltas.map(d => d.stepIndex), [0]);
});

test('funnel counts report consecutive and overall rates without inventing failures or zero-denominator rates', () => {
  const result = funnelCounts([10, 8, 4, 3]);
  assert.equal(result.completionRate, 30);
  assert.deepEqual(result.steps.map(step => step.notReachedNext), [2, 4, 1, null]);
  assert.deepEqual(result.steps.map(step => step.conversionRate), [null, 80, 50, 75]);
  assert.deepEqual(result.steps.map(step => step.reachRate), [100, 80, 40, 30]);
  const zero = funnelCounts([0, 0]); assert.equal(zero.completionRate, null);
  assert.ok(zero.steps.every(step => step.reachRate === null && step.conversionRate === null));
  for (const corrupt of [[1, 2], [0, 1], [1, -1], [1, 0.5], [Number.MAX_SAFE_INTEGER + 1, 0], [1], []])
    assert.throws(() => funnelCounts(corrupt), code('storage_unavailable'));
});
