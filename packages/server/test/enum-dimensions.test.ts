import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createTallyfinServer, ServerInputError } from '../src/index.ts';
import type { ServerPlatform } from '../src/index.ts';
import { parseServerBatch, prepareServerBatch, validateRegistry } from '../../core/src/index.ts';
import { projectServerSchema } from '../../../tools/server/schema.mjs';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
for (const mode of ['source', 'minified'] as const) {
  test(`${mode}: reviewed server funnel enum domains accept different ordering without relaxing validation`, async () => {
    const input = JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
    input.events.find((event: any) => event.name === 'job_finished').properties.kind.values.reverse();
    const registry = validateRegistry(input), schema = freeze(projectServerSchema(registry)), before = JSON.stringify(schema);
    let factory: typeof createTallyfinServer = createTallyfinServer;
    if (mode === 'minified') {
      const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
        bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2023', minify: true });
      factory = (await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.text).toString('base64'))).createTallyfinServer;
    }
    const now = Date.parse('2026-10-11T10:00:00Z'), bodies: string[] = [];
    const host: ServerPlatform = { now: () => now, monotonicNow: () => 0, uuid: () => crypto.randomUUID(),
      wait: async () => {}, fetch: async (_url, init) => {
        const body = init!.body as string; bodies.push(body);
        const batch = parseServerBatch(body), prepared = await prepareServerBatch(batch, registry, now);
        assert.deepEqual(prepared.events.map(event => event.funnel?.stepIndex).sort(), [2, 3]);
        return Response.json({ accepted: prepared.events.length, duplicates: 0 });
      } };
    const options = { endpoint: 'https://collector.example.invalid/v1/projects/modufile/server-batches', schema,
      // Test-only transport marker; never sent to an actual HTTP service.
      getToken: () => 'not-a-credential' };
    const client = factory(options, host);
    for (const value of ['pdf', 'image']) {
      const run = { funnelId: 'conversion', runId: crypto.randomUUID(), startedAt: new Date(now).toISOString() };
      const events = ['job_started', 'job_finished'].map(name => client.createEvent(name, { kind: value }, { funnel: run }));
      assert.deepEqual(await client.send(events), { status: 'delivered', accepted: 2, duplicates: 0, attempts: 1 });
      assert.throws(() => client.createEvent('job_finished', { kind: 'unknown' }, { funnel: run }), mode === 'source' ? ServerInputError : Error);
    }
    assert.equal(bodies.length, 2); assert.equal(JSON.stringify(schema), before);
    for (const values of [['pdf'], ['pdf', 'other'], ['pdf', 'pdf']]) {
      const invalid = structuredClone(schema); invalid.events.job_finished.kind = ['enum', true, values];
      assert.throws(() => factory({ ...options, schema: invalid }, host), TypeError);
    }
    assert.equal(bodies.length, 2);
  });
}
