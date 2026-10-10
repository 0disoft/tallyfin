import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTallyfinFunnels } from '../src/funnels.ts';
import type { FunnelLink, FunnelSchema } from '../src/funnels.ts';
import { FakeBrowser, endpoint } from './helpers.ts';
import { projectFunnelBrowserSchema, projectBrowserSchema } from '../../../tools/browser/schema.mjs';

const day = 86400000;
const schema: FunnelSchema = { version: 1, events: {
  selected: { kind: ['enum', true, ['pdf', 'image']] }, uploaded: { kind: ['enum', true, ['pdf', 'image']] }, view: {},
}, funnels: { task: { steps: ['selected', 'uploaded', null, null], dimensions: ['kind'] },
  server_first: { steps: [null, 'uploaded'], dimensions: ['kind'] } } };
function fixture(definition = schema) {
  const host = new FakeBrowser();
  return { host, client: createTallyfinFunnels({ endpoint, schema: definition }, host) };
}
const forwarded = (host: FakeBrowser, funnelId = 'server_first'): FunnelLink => ({
  funnelId, runId: crypto.randomUUID(), startedAt: new Date(host.time - 1000).toISOString(),
});

test('browser projection preserves server milestone positions without exposing server rules or labels', () => {
  const registry = JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
  const projected = projectFunnelBrowserSchema(registry);
  assert.deepEqual(projected.funnels, { conversion: { steps: ['file_selected', 'upload_finished', null, null], dimensions: ['kind'] } });
  assert.equal(JSON.stringify(projected).includes('job_started'), false);
  assert.equal(JSON.stringify(projected).includes('Reviewed'), false);
  assert.equal(Object.hasOwn(projected, 'workflows'), false);
  assert.equal(Object.hasOwn(projectBrowserSchema(registry), 'funnels'), false);
  const { client } = fixture(projected);
  assert.ok(client.createFunnelRun('conversion')); client.destroy();
  registry.funnels[0].steps = registry.funnels[0].steps.slice(2);
  assert.throws(() => projectFunnelBrowserSchema(registry), /browser funnel/);
});

test('fresh immutable task links are inert and the first milestone uses the exact start time', async () => {
  const { client, host } = fixture(), first = client.createFunnelRun('task')!, second = client.createFunnelRun('task')!;
  assert.ok(Object.isFrozen(first)); assert.notEqual(first.runId, second.runId);
  assert.equal(client.pending, 0); assert.equal(host.calls.length, 0); assert.equal(host.timers.size, 0);
  assert.equal(client.createFunnelRun('server_first'), undefined); assert.equal(client.createFunnelRun('unknown'), undefined);
  host.time += 17;
  assert.equal(client.trackFunnel('selected', { kind: 'pdf' }, first), true);
  assert.equal(client.track('selected', { kind: 'pdf' }), false);
  client.flush(); await host.tick(0);
  const event = JSON.parse(host.calls[0]!.body).events[0];
  assert.equal(event.occurredAt, first.startedAt); assert.deepEqual(event.funnel, first);
  assert.equal(Object.hasOwn(event, 'attempt'), false); client.destroy();
});

test('network retries preserve bytes and caller mutations cannot replace the queued run or dimensions', async () => {
  const { client, host } = fixture(), run = { ...forwarded(host), startedAt: new Date(host.time - 1000).toISOString().replace('.000', '') };
  const properties = { kind: 'pdf' };
  assert.equal(client.trackFunnel('uploaded', properties, run), true);
  const original = { ...run }; run.runId = crypto.randomUUID(); properties.kind = 'image';
  host.reply = async index => ({ status: index === 0 ? 503 : 200, retryAfter: null });
  client.flush(); await host.tick(1000);
  assert.equal(host.calls.length, 2); assert.equal(host.calls[0]!.body, host.calls[1]!.body);
  const event = JSON.parse(host.calls[0]!.body).events[0];
  assert.deepEqual(event.funnel, { ...original, startedAt: new Date(original.startedAt).toISOString() });
  assert.deepEqual(event.properties, { kind: 'pdf' }); assert.equal(client.pending, 0); client.destroy();
});

test('manual restoration retains logical task and occurrence time, including valid non-millisecond UTC input', async () => {
  const { host, client } = fixture(), run = forwarded(host);
  const occurredAt = new Date(host.time).toISOString();
  assert.equal(client.trackFunnel('uploaded', { kind: 'pdf' }, run, occurredAt), true);
  client.flush(); await host.tick(0); client.destroy(); host.time += 2000;
  const restored = createTallyfinFunnels({ endpoint, schema }, host);
  assert.equal(restored.trackFunnel('uploaded', { kind: 'pdf' }, run, occurredAt), true);
  restored.flush(); await host.tick(0);
  const first = JSON.parse(host.calls[0]!.body).events[0], second = JSON.parse(host.calls[1]!.body).events[0];
  assert.notEqual(first.eventId, second.eventId);
  assert.deepEqual({ ...second, eventId: first.eventId }, first);
  const short = { ...run, startedAt: new Date(host.time).toISOString().replace(/\.\d{3}Z$/, '.1Z'), funnelId: 'task' };
  assert.equal(restored.trackFunnel('selected', { kind: 'image' }, short, short.startedAt), true);
  restored.destroy();
});

test('malformed or foreign links, invalid dates and incompatible milestones fail before enqueue', () => {
  const { client, host } = fixture(), run = forwarded(host);
  for (const input of [null, {}, { ...run, funnelId: 'unknown' }, { ...run, runId: 'visitor-id' },
    { ...run, funnelId: { toString: () => 'server_first' } },
    { ...run, startedAt: '2026-02-30T00:00:00Z' }, { ...run, startedAt: '2026-10-08T15:00:00+00:00' },
    { ...run, startedAt: '2026-10-08T15:00:00.1234Z' }, { ...run, private_detail: 'unreviewed' },
    Object.create(run, { runId: { value: run.runId, enumerable: true } }),
    { ...run, startedAt: new Date(host.time + 1).toISOString() },
    { ...run, startedAt: new Date(host.time - day - 1).toISOString() }]) {
    assert.equal(client.trackFunnel('uploaded', { kind: 'pdf' }, input as any), false);
  }
  assert.equal(client.trackFunnel('view', {}, run), false);
  assert.equal(client.trackFunnel('job_started', { kind: 'pdf' }, run), false);
  assert.equal(client.trackFunnel('uploaded', { kind: 'secret' }, run), false);
  assert.equal(client.trackFunnel('uploaded', { kind: 'pdf', text: 'secret' }, run), false);
  assert.equal(client.trackFunnel('uploaded', {}, run), false);
  assert.equal(client.trackFunnel('uploaded', { kind: 'pdf' }, run, 'not-time'), false);
  assert.equal(client.trackFunnel('uploaded', { kind: 'pdf' }, run, new Date(host.time + 300001).toISOString()), false);
  assert.equal(client.pending, 0); assert.equal(host.calls.length, 0); client.destroy();
});

test('exact duration boundaries are allowed but stale occurrences and unequal first-stage times are rejected', () => {
  const { client, host } = fixture(), run = client.createFunnelRun('task')!;
  host.time += 1;
  assert.equal(client.trackFunnel('selected', { kind: 'pdf' }, run, new Date(host.time).toISOString()), false);
  host.time = Date.parse(run.startedAt) + day;
  assert.equal(client.trackFunnel('uploaded', { kind: 'pdf' }, run), true);
  host.time++;
  assert.equal(client.trackFunnel('uploaded', { kind: 'pdf' }, run), false);
  assert.equal(client.trackFunnel('selected', { kind: 'pdf' }, run), false); client.destroy();
});

test('invalid profiles install no listeners, and disabled or destroyed clients stay inert', () => {
  const variants = [null, [], {}, { task: { steps: [null, null], dimensions: [] } },
    { task: { steps: ['selected', 'selected'], dimensions: [] } }, { task: { steps: ['selected'], dimensions: [] } },
    { task: { steps: ['selected', 'uploaded'], dimensions: ['kind', 'kind'] } },
    { task: { steps: ['selected', 'unknown'], dimensions: [] } },
    { task: { steps: ['selected', 'view'], dimensions: ['kind'] } },
    { task: { steps: ['selected', 'uploaded'], dimensions: ['kind'], label: 'extra' } },
    Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`f_${index}`, schema.funnels.task]))];
  for (const funnels of variants) {
    const { client, host } = fixture({ ...schema, funnels } as any);
    assert.equal(host.listeners.size, 0); assert.equal(client.createFunnelRun('task'), undefined);
    assert.equal(client.track('view'), false);
  }
  const mismatch = structuredClone(schema); (mismatch.events.uploaded as any).kind = ['enum', false, ['pdf']];
  assert.equal(fixture(mismatch).host.listeners.size, 0);
  assert.equal(fixture({ ...schema, workflows: {} } as any).host.listeners.size, 0);
  const host = new FakeBrowser(), off = createTallyfinFunnels({ endpoint, schema, enabled: false }, host);
  assert.equal(host.listeners.size, 0); assert.equal(off.createFunnelRun('task'), undefined);
  const client = createTallyfinFunnels({ endpoint, schema }, host), run = client.createFunnelRun('task')!;
  assert.equal(client.track('view'), true); client.destroy();
  assert.equal(client.track('view'), false); assert.equal(client.trackFunnel('selected', { kind: 'pdf' }, run), false);
  assert.equal(client.createFunnelRun('task'), undefined); assert.equal(host.listeners.size, 0); assert.equal(host.timers.size, 0);
});

test('the configured schema is serialized only once and the validated snapshot cannot be replaced', () => {
  let reads = 0;
  const configuration = { ...schema, toJSON() { reads++; return reads === 1 ? schema : { ...schema, funnels: {} }; } };
  const { client, host } = fixture(configuration);
  assert.equal(reads, 1); assert.ok(client.createFunnelRun('task')); assert.equal(host.listeners.size, 1);
  client.destroy();
});
