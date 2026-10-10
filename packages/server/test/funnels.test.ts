import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTallyfinServer, ServerInputError } from '../src/index.ts';
import type { FunnelLink, ServerPlatform, ServerSchema } from '../src/index.ts';
import { projectServerSchema } from '../../../tools/server/schema.mjs';

const initial = Date.parse('2026-10-11T10:00:00Z'), day = 86400000;
const schema: ServerSchema = { version: 1, events: {
  job_started: { kind: ['enum', true, ['pdf', 'image']] }, job_finished: { kind: ['enum', true, ['pdf', 'image']] }, diagnostic: {},
}, funnels: { task: { steps: ['job_started', 'job_finished'], dimensions: ['kind'] },
  mixed: { steps: [null, null, 'job_started', 'job_finished'], dimensions: ['kind'] } } };
function fixture(definition = schema) {
  const state = { time: initial, tokens: 0, calls: [] as string[], reply: (index: number): Response =>
    index === 0 ? new Response(null, { status: 503 }) : Response.json({ accepted: 0, duplicates: 1 }) };
  const host: ServerPlatform = { now: () => state.time, monotonicNow: () => state.time - initial, uuid: () => crypto.randomUUID(),
    wait: async ms => { state.time += ms; }, fetch: async (_url, init) => { state.calls.push(init!.body as string); return state.reply(state.calls.length - 1); } };
  const options = { endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches', schema: definition,
    getToken: () => { state.tokens++; return 'not-a-credential'; } };
  return { state, host, options, client: createTallyfinServer(options, host) };
}
const link = (funnelId = 'mixed'): FunnelLink => ({ funnelId, runId: crypto.randomUUID(), startedAt: new Date(initial - 1000).toISOString() });

test('server projection keeps milestone positions and finite dimensions without shipping browser names or rules', () => {
  const registry = JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
  const projected = projectServerSchema(registry);
  assert.deepEqual(projected.funnels, { conversion: { steps: [null, null, 'job_started', 'job_finished'], dimensions: ['kind'] } });
  assert.equal(JSON.stringify(projected).includes('file_selected'), false);
  assert.equal(JSON.stringify(projected).includes('Reviewed'), false);
  const { client } = fixture(projected);
  const run = { ...link(), funnelId: 'conversion' };
  assert.deepEqual(client.createEvent('job_started', { kind: 'pdf' }, { funnel: run }).funnel, run);
  registry.funnels[0].steps = registry.funnels[0].steps.slice(0, 2);
  assert.equal(Object.hasOwn(projectServerSchema(registry), 'funnels'), false);
});

test('run creation is inert and fresh per task, first milestone retains the exact start timestamp', () => {
  const { client, state } = fixture(), first = client.createFunnelRun('task'), second = client.createFunnelRun('task');
  assert.ok(Object.isFrozen(first)); assert.notEqual(first.runId, second.runId);
  state.time += 17;
  const event = client.createEvent('job_started', { kind: 'pdf' }, { funnel: first });
  assert.equal(event.occurredAt, first.startedAt); assert.deepEqual(event.funnel, first);
  assert.ok(Object.isFrozen(event.funnel)); assert.equal(state.tokens, 0); assert.equal(state.calls.length, 0);
  assert.throws(() => client.createFunnelRun('mixed'), ServerInputError);
  assert.throws(() => client.createFunnelRun('unknown'), ServerInputError);
  assert.throws(() => client.createEvent('job_started', { kind: 'pdf' }, { funnel: first, occurredAt: new Date(state.time).toISOString() }), ServerInputError);
});

test('forwarded links are snapshotted, normalized and retained across response-loss retry and process restoration', async () => {
  const { client, state } = fixture(), run = { ...link(), startedAt: '2026-10-11T09:59:59Z' };
  const event = client.createEvent('job_finished', { kind: 'pdf' }, { funnel: run });
  run.runId = crypto.randomUUID(); assert.notEqual(event.funnel!.runId, run.runId);
  assert.equal(event.funnel!.startedAt, '2026-10-11T09:59:59.000Z');
  const input = JSON.parse(JSON.stringify(event));
  state.reply = index => { if (index === 0) { input.funnel.runId = crypto.randomUUID(); return new Response(null, { status: 503 }); }
    return Response.json({ accepted: 0, duplicates: 1 }); };
  assert.deepEqual(await client.send([input]), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 2 });
  assert.equal(state.calls[0], state.calls[1]); assert.equal(JSON.parse(state.calls[0]!).events[0].funnel.runId, event.funnel!.runId);
  const restored = client.createEvent(event.name, event.properties, { eventId: event.eventId, occurredAt: event.occurredAt, funnel: event.funnel! });
  assert.deepEqual(restored, event);
});

test('malformed, foreign and source-mismatched links fail locally without acquiring credentials', async () => {
  const { client, state } = fixture(), run = link(), event = client.createEvent('job_finished', { kind: 'pdf' });
  for (const invalid of [null, {}, { ...run, funnelId: 'unknown' }, { ...run, runId: 'account-id' },
    { ...run, startedAt: '2026-02-30T00:00:00Z' }, { ...run, private_detail: 'secret' },
    { ...run, startedAt: new Date(initial + 1).toISOString() }, { ...run, startedAt: new Date(initial - day - 1).toISOString() }]) {
    assert.throws(() => client.createEvent('job_finished', { kind: 'pdf' }, { funnel: invalid as any }), ServerInputError);
    assert.equal((await client.send([{ ...event, funnel: invalid } as any])).status, 'rejected');
  }
  assert.throws(() => client.createEvent('diagnostic', {}, { funnel: run }), ServerInputError);
  assert.equal((await client.send([{ ...event, funnel: run, attempt: {} } as any])).status, 'rejected');
  assert.equal(state.tokens, 0); assert.equal(state.calls.length, 0);
});

test('exact 24-hour window is allowed and wrong first-stage time cannot become an ordinary event', () => {
  const { client, state } = fixture(), run = client.createFunnelRun('task'); state.time += day;
  assert.ok(client.createEvent('job_finished', { kind: 'pdf' }, { funnel: run }));
  state.time++; assert.throws(() => client.createEvent('job_finished', { kind: 'pdf' }, { funnel: run }), ServerInputError);
  assert.throws(() => client.createEvent('job_started', { kind: 'pdf' }, { funnel: { ...run, startedAt: new Date(state.time - 1).toISOString() },
    occurredAt: new Date(state.time).toISOString() }), ServerInputError);
});

test('projected funnel definitions reject unknown keys, missing server stages and incompatible required dimensions', () => {
  const { host, options, state } = fixture();
  const variants = [null, [], { task: { steps: [null, null], dimensions: [] } },
    { task: { steps: ['job_started', 'job_started'], dimensions: [] } }, { task: { steps: ['job_started'], dimensions: [] } },
    { task: { steps: ['job_started', 'job_finished'], dimensions: ['kind', 'kind'] } },
    { task: { steps: ['browser_name', 'job_started'], dimensions: [] } },
    { task: { steps: ['job_started', 'diagnostic'], dimensions: ['kind'] } },
    { task: { steps: ['job_started', 'job_finished'], dimensions: ['kind'], label: 'extra' } }];
  for (const funnels of variants) assert.throws(() => createTallyfinServer({ ...options, schema: { ...schema, funnels } as any }, host), TypeError);
  const mismatched = structuredClone(schema); (mismatched.events.job_finished as any).kind = ['enum', false, ['pdf']];
  assert.throws(() => createTallyfinServer({ ...options, schema: mismatched }, host), TypeError);
  const tooMany = { ...schema, funnels: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f_${i}`, schema.funnels!.task])) };
  assert.throws(() => createTallyfinServer({ ...options, schema: tooMany }, host), TypeError);
  assert.equal(state.tokens, 0); assert.equal(state.calls.length, 0);
});

test('send requires own mandatory fields and cannot serialize a prototype-supplied event identity', async () => {
  const { client, state } = fixture(), event = client.createEvent('job_finished', { kind: 'pdf' }, { funnel: link() });
  const inherited = Object.create(event, { properties: { value: { kind: 'pdf' }, enumerable: true } });
  assert.equal((await client.send([inherited])).status, 'rejected'); assert.equal(state.tokens, 0);
});
