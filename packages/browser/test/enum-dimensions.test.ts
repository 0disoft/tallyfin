import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createTallyfin } from '../src/index.ts';
import { createTallyfinFunnels } from '../src/funnels.ts';
import { parseBatch, prepareBatch, validateRegistry } from '../../core/src/index.ts';
import { projectBrowserSchema, projectFunnelBrowserSchema } from '../../../tools/browser/schema.mjs';
import { endpoint, FakeBrowser } from './helpers.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
async function bundled(entry: string) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true, mangleProps: /^__tfBatch/ });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'));
}

for (const mode of ['source', 'minified'] as const) {
  test(`${mode}: reviewed workflow enum domains accept different ordering without mutating the schema`, async () => {
    const input = JSON.parse(readFileSync(new URL('../../../api/examples/registry.json', import.meta.url), 'utf8'));
    const workflow = input.workflows[0];
    input.events.find((event: any) => event.name === workflow.successEvent).properties.tool.values.reverse();
    const registry = validateRegistry(input), schema = freeze(projectBrowserSchema(registry)), before = JSON.stringify(schema);
    const factory: typeof createTallyfin = mode === 'source' ? createTallyfin : (await bundled('../src/index.ts')).createTallyfin;
    const host = new FakeBrowser(), client = factory({ endpoint, schema }, host);
    try {
      const attempt = client.start(workflow.id, { tool: 'loan' });
      assert.ok(attempt, 'valid reviewed workflow must remain enabled');
      assert.equal(attempt.succeed(), true);
      client.flush(); await host.tick(0);
      const prepared = await prepareBatch(parseBatch(host.calls[0]!.body), registry, host.time);
      assert.equal(prepared.events.length, 2);
      assert.deepEqual(prepared.events.map(event => event.workflow?.phase).sort(), ['start', 'success']);
      assert.equal(JSON.stringify(schema), before);
    } finally { client.destroy(); }
    assert.equal(host.timers.size, 0); assert.equal(host.listeners.size, 0);
    for (const values of [['loan'], ['loan', 'other'], ['loan', 'loan']]) {
      const invalid = structuredClone(schema); invalid.events[workflow.successEvent].tool = ['enum', true, values];
      const host = new FakeBrowser(), client = factory({ endpoint, schema: invalid }, host);
      try { assert.equal(client.start(workflow.id, { tool: 'loan' }), undefined); }
      finally { client.destroy(); }
      assert.equal(host.calls.length, 0); assert.equal(host.listeners.size, 0); assert.equal(host.timers.size, 0);
    }
  });

  test(`${mode}: reviewed browser funnel enum domains accept different ordering and still reject different sets`, async () => {
    const input = JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
    input.events.find((event: any) => event.name === 'upload_finished').properties.kind.values.reverse();
    const registry = validateRegistry(input), schema = freeze(projectFunnelBrowserSchema(registry)), before = JSON.stringify(schema);
    const factory: typeof createTallyfinFunnels = mode === 'source' ? createTallyfinFunnels : (await bundled('../src/funnels.ts')).createTallyfinFunnels;
    for (const value of ['pdf', 'image']) {
      const host = new FakeBrowser(), client = factory({ endpoint, schema }, host);
      try {
        const run = client.createFunnelRun('conversion');
        assert.ok(run, 'valid reviewed funnel must remain enabled');
        assert.equal(client.trackFunnel('file_selected', { kind: value }, run), true);
        assert.equal(client.trackFunnel('upload_finished', { kind: value }, run), true);
        assert.equal(client.trackFunnel('upload_finished', { kind: 'unknown' }, run), false);
        client.flush(); await host.tick(0);
        const prepared = await prepareBatch(parseBatch(host.calls[0]!.body), registry, host.time);
        assert.deepEqual(prepared.events.map(event => event.funnel?.stepIndex).sort(), [0, 1]);
        assert.equal(JSON.stringify(schema), before);
      } finally { client.destroy(); }
      assert.equal(host.timers.size, 0); assert.equal(host.listeners.size, 0);
    }
    for (const values of [['pdf'], ['pdf', 'other'], ['pdf', 'pdf']]) {
      const invalid = structuredClone(schema); invalid.events.upload_finished!.kind = ['enum', true, values];
      const host = new FakeBrowser(), client = factory({ endpoint, schema: invalid }, host);
      try { assert.equal(client.createFunnelRun('conversion'), undefined); }
      finally { client.destroy(); }
      assert.equal(host.calls.length, 0); assert.equal(host.listeners.size, 0); assert.equal(host.timers.size, 0);
    }
  });
}
