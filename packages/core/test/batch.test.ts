import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CollectionError, dimensionKey, parseBatch, prepareBatch, utcMillis, validateRegistry } from '../src/index.ts';

const example = (file: string) => JSON.parse(readFileSync(new URL(`../../../api/examples/${file}.json`, import.meta.url), 'utf8'));
const registry = validateRegistry(example('registry'));
const now = Date.parse('2026-10-08T15:00:15Z');
const batch = () => example('browser-batch');
const rejects = async (mutate: (b: ReturnType<typeof batch>) => void, code = 'invalid_event') => {
  const input = batch(); mutate(input);
  await assert.rejects(async () => prepareBatch(parseBatch(JSON.stringify(input)), registry, now), (error: unknown) => error instanceof CollectionError && error.code === code);
};
test('example normalizes times and assigns event days separately from the cohort', async () => {
  const result = await prepareBatch(parseBatch(JSON.stringify(batch())), registry, now);
  assert.deepEqual(result.events.map(e => e.eventDate), ['2026-10-08', '2026-10-09']);
  assert.deepEqual(result.events.map(e => e.workflow?.cohortDate), ['2026-10-08', '2026-10-08']);
  assert.equal(result.events[0]!.event.occurredAt, '2026-10-08T14:59:50.000Z');
  assert.match(result.events[0]!.payloadHash, /^[a-f0-9]{64}$/);
});
test('hash ignores property order and UTC fractional-zero spelling, but includes version and content', async () => {
  const a = batch(); const b = batch();
  b.events[0].occurredAt = '2026-10-08T14:59:50.0Z'; b.events[0].attempt.startedAt = '2026-10-08T14:59:50.00Z';
  const first = await prepareBatch(parseBatch(JSON.stringify(a)), registry, now);
  const second = await prepareBatch(parseBatch(JSON.stringify(b)), registry, now);
  assert.equal(first.events[0]!.payloadHash, second.events[0]!.payloadHash);
  b.events[0].properties.tool = 'timer';
  const third = await prepareBatch(parseBatch(JSON.stringify(b)), registry, now);
  assert.notEqual(first.events[0]!.payloadHash, third.events[0]!.payloadHash);
  const v2 = structuredClone(registry); v2.schemaVersion = 2; a.schemaVersion = 2;
  assert.notEqual(first.events[0]!.payloadHash, (await prepareBatch(parseBatch(JSON.stringify(a)), v2, now)).events[0]!.payloadHash);
  assert.notEqual(dimensionKey({}, ['flag']), dimensionKey({ flag: false }, ['flag']));
  assert.notEqual(dimensionKey({ flag: false }), dimensionKey({ flag: 0 }));
  assert.equal(dimensionKey({ b: 'x', a: true }), dimensionKey({ a: true, b: 'x' }));
});
for (const [name, mutate, code] of [
  ['unknown envelope key', (b: any) => { b.userId = 'secret'; }, 'invalid_request'],
  ['unknown schema', (b: any) => { b.schemaVersion = 2; }, 'unknown_schema'],
  ['unknown event', (b: any) => { b.events[0].name = 'not_registered'; }, 'invalid_event'],
  ['unknown property', (b: any) => { b.events[0].properties.user_id = 'private'; }, 'invalid_event'],
  ['inherited property name', (b: any) => { b.events[0].properties.constructor = false; }, 'invalid_event'],
  ['unknown event key', (b: any) => { b.events[0].url = 'private'; }, 'invalid_event'],
  ['wrong enum', (b: any) => { b.events[0].properties.tool = 'email'; }, 'invalid_event'],
  ['missing property', (b: any) => { b.events[0].properties = {}; }, 'invalid_event'],
  ['nested property', (b: any) => { b.events[0].properties.tool = { id: 'loan' }; }, 'invalid_event'],
  ['bad UUID', (b: any) => { b.events[0].eventId = 'visitor'; }, 'invalid_event'],
  ['duplicate ID within batch', (b: any) => { b.events[1].eventId = b.events[0].eventId; }, 'invalid_event'],
  ['invalid calendar date', (b: any) => { b.events[0].occurredAt = '2026-02-30T00:00:00Z'; }, 'invalid_event'],
  ['submillisecond precision', (b: any) => { b.events[0].occurredAt = '2026-10-08T14:59:50.0001Z'; }, 'invalid_event'],
  ['expired event', (b: any) => { b.events[0].occurredAt = '2026-10-07T15:00:14Z'; }, 'invalid_event'],
  ['future event', (b: any) => { b.events[0].occurredAt = '2026-10-08T15:05:16Z'; }, 'invalid_event'],
  ['missing workflow', (b: any) => { delete b.events[0].attempt; }, 'invalid_event'],
  ['start time mismatch', (b: any) => { b.events[0].attempt.startedAt = '2026-10-08T14:59:49Z'; }, 'invalid_event'],
  ['terminal before start', (b: any) => { b.events[1].attempt.startedAt = '2026-10-08T15:00:11Z'; }, 'invalid_event'],
  ['workflow on ordinary event', (b: any) => { b.events[0].name = 'tool_view'; }, 'invalid_event'],
] as const) test(`reject ${name}`, () => rejects(mutate, code));
test('exact time boundaries and singleton ordinary batch', async () => {
  for (const offset of [-86_400_000, 300_000]) {
    const b = batch(); b.events = [{ ...b.events[0], name: 'tool_view', occurredAt: new Date(now + offset).toISOString() }];
    delete b.events[0].attempt;
    await prepareBatch(parseBatch(JSON.stringify(b)), registry, now);
  }
  assert.equal(utcMillis('2000-02-29T00:00:00Z'), Date.parse('2000-02-29T00:00:00Z'));
  assert.throws(() => utcMillis('2026-01-01T24:00:00Z'));
});
test('UTF-8 byte limit and malformed JSON', () => {
  assert.throws(() => parseBatch('가'.repeat(6000)), (e: unknown) => e instanceof CollectionError && e.status === 413);
  assert.throws(() => parseBatch('{'), (e: unknown) => e instanceof CollectionError && e.status === 400);
});
test('registry rejects unsafe origin, excessive cardinality and conflicting workflow bindings', () => {
  for (const mutate of [
    (r: any) => { r.allowedOrigins = ['https://example.invalid/']; },
    (r: any) => { r.allowedOrigins = ['https://*.example.invalid']; },
    (r: any) => { r.allowedOrigins = ['http://localhost:5173']; },
    (r: any) => { r.project.timeZone = '+09:00'; },
    (r: any) => { r.events[0].properties.number = { type: 'integer', required: true, purpose: 'bucket', minimum: 0, maximum: 32 }; },
    (r: any) => { r.workflows.push({ ...r.workflows[0], id: 'other' }); },
    (r: any) => { r.events[2].properties.tool.values = ['other']; },
    (r: any) => { r.events[0].properties.a = { type: 'enum', required: false, purpose: 'bucket', values: Array.from({ length: 32 }, (_, i) => `a${i}`) }; r.events[0].properties.b = { ...r.events[0].properties.a }; },
  ]) { const r = example('registry'); mutate(r); assert.throws(() => validateRegistry(r)); }
  const local = example('registry'); local.allowedOrigins = ['http://localhost:5173'];
  assert.equal(validateRegistry(local, { allowLocalHttp: true }).allowedOrigins[0], 'http://localhost:5173');
});
