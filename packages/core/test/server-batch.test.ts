import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canonicalEvent, CollectionError, DAY, parseBatch, parseServerBatch, planIngest, prepareBatch,
  prepareServerBatch, sha256, validateRegistry } from '../src/index.ts';
import type { IngestSnapshot, ServerBatch } from '../src/index.ts';

const example = (file: string) => JSON.parse(readFileSync(new URL(`../../../api/examples/${file}.json`, import.meta.url), 'utf8'));
const now = Date.parse('2026-10-08T15:00:15Z');
const batch = (): ServerBatch => example('server-batch');
function registry() {
  const value = example('registry');
  value.events.push({ name: 'job_finished', label: 'Job finished', source: 'server', properties: {
    outcome: { type: 'enum', values: ['success', 'failure'], required: true, purpose: 'Job result category' },
    retried: { type: 'boolean', required: false, purpose: 'Retry category' },
  } });
  return validateRegistry(value);
}
const empty = (): IngestSnapshot => ({ receipts: [], attempts: [], newReceiptsToday: 0 });
const isError = (code: string, status: number) => (error: unknown) => error instanceof CollectionError && error.code === code && error.status === status;

test('server batch accepts only its own closed envelope and rejects browser attempts and source crossover', async () => {
  assert.deepEqual(parseServerBatch(JSON.stringify(batch())), batch());
  assert.throws(() => parseBatch(JSON.stringify(batch())), isError('invalid_request', 400));
  assert.throws(() => parseServerBatch(JSON.stringify(example('browser-batch'))), isError('invalid_request', 400));
  for (const mutate of [(v: any) => v.source = 'browser', (v: any) => v.source = 'other', (v: any) => v.token = 'extra',
    (v: any) => v.events = [], (v: any) => v.events = Array(21).fill(v.events[0])]) {
    const value = batch(); mutate(value); assert.throws(() => parseServerBatch(JSON.stringify(value)), isError('invalid_request', 400));
  }
  for (const mutate of [(v: any) => v.events[0].attempt = example('browser-batch').events[0].attempt,
    (v: any) => v.events[0].attempt = null, (v: any) => v.events[0].email = 'private',
    (v: any) => v.events[0].eventId = 'persistent-id', (v: any) => v.events.push(v.events[0]),
    (v: any) => v.events[0].occurredAt = '2026-02-30T15:00:10Z']) {
    const value = batch(); mutate(value); assert.throws(() => parseServerBatch(JSON.stringify(value)), isError('invalid_event', 422));
  }
  assert.throws(() => parseServerBatch('가'.repeat(6000)), isError('invalid_request', 413));
  assert.throws(() => parseServerBatch('{'), isError('invalid_request', 400));
  await assert.rejects(prepareBatch(batch() as any, registry(), now), isError('invalid_request', 400));
  await assert.rejects(prepareServerBatch(example('browser-batch'), registry(), now), isError('invalid_request', 400));
});

test('server definitions, properties, version and time bounds are checked without creating workflow state', async () => {
  const prepared = await prepareServerBatch(parseServerBatch(JSON.stringify(batch())), registry(), now);
  assert.equal(prepared.source, 'server'); assert.equal(prepared.events[0]!.eventDate, '2026-10-09');
  assert.equal(prepared.events[0]!.event.occurredAt, '2026-10-08T15:00:10.000Z');
  assert.ok(!Object.hasOwn(prepared.events[0]!, 'workflow')); assert.ok(!Object.hasOwn(prepared.events[0]!.event, 'attempt'));
  for (const mutate of [(v: any) => v.events[0].name = 'tool_view',
    (v: any) => v.events[0].properties.outcome = 'unknown', (v: any) => v.events[0].properties = {},
    (v: any) => v.events[0].properties.retried = 0, (v: any) => v.events[0].properties.user_id = 'private',
    (v: any) => v.events[0].properties.outcome = { result: 'success' },
    (v: any) => v.events[0].occurredAt = new Date(now - DAY - 1).toISOString(),
    (v: any) => v.events[0].occurredAt = new Date(now + 300001).toISOString(),
    (v: any) => v.events[0].attempt = undefined]) {
    const value = batch(); mutate(value);
    await assert.rejects(prepareServerBatch(value, registry(), now), isError('invalid_event', 422));
  }
  for (const offset of [-DAY, 300000]) {
    const value = batch(); value.events[0]!.occurredAt = new Date(now + offset).toISOString();
    await prepareServerBatch(parseServerBatch(JSON.stringify(value)), registry(), now);
  }
  const wrongVersion = batch(); wrongVersion.schemaVersion = 2;
  await assert.rejects(prepareServerBatch(wrongVersion, registry(), now), isError('unknown_schema', 422));
  const retired = registry(); retired.schemaStatus = 'retired';
  await assert.rejects(prepareServerBatch(batch(), retired, now), isError('unknown_schema', 422));
  const paused = registry(); paused.project.status = 'paused';
  await assert.rejects(prepareServerBatch(batch(), paused, now), isError('project_unavailable', 403));
});

test('source participates in the event hash while browser canonical bytes remain unchanged', async () => {
  const input = batch().events[0]!;
  const normalized = { ...input, occurredAt: '2026-10-08T15:00:10.000Z' };
  // Exact serialization is the existing persisted-browser receipt compatibility boundary.
  const expected = JSON.stringify(['sembom', 1, 'browser', normalized.eventId, normalized.name,
    normalized.occurredAt, JSON.stringify([['outcome', 'string', 'success'], ['retried', 'boolean', false]]), null]);
  assert.equal(canonicalEvent('sembom', 1, normalized), expected);
  assert.notEqual(canonicalEvent('sembom', 1, normalized), canonicalEvent('sembom', 1, normalized, 'server'));
  assert.notEqual(await sha256(expected), await sha256(canonicalEvent('sembom', 1, normalized, 'server')));
  const first = await prepareServerBatch(batch(), registry(), now), changed = batch();
  changed.events[0]!.properties = { retried: false, outcome: 'success' };
  changed.events[0]!.occurredAt = '2026-10-08T15:00:10.000Z';
  const second = await prepareServerBatch(changed, registry(), now);
  assert.equal(first.events[0]!.payloadHash, second.events[0]!.payloadHash);
  changed.events[0]!.properties.retried = true;
  assert.notEqual(first.events[0]!.payloadHash, (await prepareServerBatch(changed, registry(), now)).events[0]!.payloadHash);
});

test('server plans produce only receipts and event counts, deduplicate retries and fail conflicting writes or quota', async () => {
  const prepared = await prepareServerBatch(batch(), registry(), now);
  const snapshot = empty(), untouched = structuredClone(snapshot), first = planIngest(prepared, snapshot, 1);
  assert.equal(first.accepted, 1); assert.equal(first.duplicates, 0);
  assert.equal(first.receipts[0]!.expires_at, now + 2 * DAY);
  assert.deepEqual(first.events.map(value => [value.event_date, value.event_name, value.count]), [['2026-10-09', 'job_finished', 1]]);
  assert.deepEqual(first.workflows, []); assert.deepEqual(first.attempts, []); assert.deepEqual(snapshot, untouched);
  const retry = planIngest(prepared, { receipts: first.receipts, attempts: [], newReceiptsToday: 1 }, 1);
  assert.equal(retry.duplicates, 1); assert.equal(retry.accepted, 0); assert.deepEqual(retry.events, []);
  const different = batch(); different.events[0]!.properties.outcome = 'failure';
  const conflicted = await prepareServerBatch(different, registry(), now);
  assert.throws(() => planIngest(conflicted, { receipts: first.receipts, attempts: [], newReceiptsToday: 1 }, 10), isError('event_conflict', 409));
  assert.throws(() => planIngest(prepared, { receipts: [], attempts: [], newReceiptsToday: 1 }, 1), isError('quota_exceeded', 429));
});
