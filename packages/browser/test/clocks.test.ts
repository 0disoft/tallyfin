import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createTallyfin } from '../src/index.ts';
import { createTallyfinFunnels } from '../src/funnels.ts';
import { endpoint, FakeBrowser, schema } from './helpers.ts';

for (const minified of [false, true]) {
  test(`${minified ? 'minified' : 'source'}: wall-clock changes cannot extend or prematurely exhaust retry budgets`, async () => {
    const create = minified ? (await bundled('index')).createTallyfin : createTallyfin;
    for (const elapsed of [599999, 600000, 600001]) for (const shift of [-3600000, 3600000]) {
      const host = new FakeBrowser(), start = host.time;
      let wall = start; host.now = () => wall;
      host.reply = async index => ({ status: index === 0 ? 503 : 200, retryAfter: null });
      const client = create({ endpoint, schema }, host);
      try {
        client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
        wall += shift; host.time = start + elapsed; await host.tick(0);
        assert.equal(host.calls.length, elapsed < 600000 ? 2 : 1);
        assert.equal(client.pending, 0); assert.equal(host.timers.size, 0);
        const event = JSON.parse(host.calls[0]!.body).events[0];
        assert.equal(event.occurredAt, new Date(start).toISOString());
      } finally { client.destroy(); }
    }
  });

  test(`${minified ? 'minified' : 'source'}: twenty maximum-length workflow and funnel events fit in 16 KiB`, async () => {
    const workflowCreate = minified ? (await bundled('index')).createTallyfin : createTallyfin;
    const funnelCreate = minified ? (await bundled('funnels')).createTallyfinFunnels : createTallyfinFunnels;
    const first = 'a'.repeat(48), last = 'b'.repeat(48), task = 'c'.repeat(48);
    const dimensions = Array.from({ length: 4 }, (_, i) => `p${i}`.padEnd(48, 'x'));
    const properties = Object.fromEntries(dimensions.map(key => [key, 'v'.repeat(32)]));
    const rules = Object.fromEntries(dimensions.map(key => [key, ['enum', true, ['v'.repeat(32)]]]));
    const events = { [first]: rules, [last]: rules };
    for (const profile of ['workflow', 'funnel']) {
      const host = new FakeBrowser();
      const client = profile === 'workflow'
        ? workflowCreate({ endpoint, schema: { version: 2147483647, events, workflows: {
          [task]: { start: first, success: last, dimensions },
        } } }, host)
        : funnelCreate({ endpoint, schema: { version: 2147483647, events, funnels: {
          [task]: { steps: [first, last], dimensions },
        } } }, host);
      try {
        for (let i = 0; i < 20; i++) {
          if (profile === 'workflow') assert.ok(client.start(task, properties));
          else assert.equal(client.trackFunnel(first, properties, client.createFunnelRun(task)), true);
        }
        await host.tick(0);
        assert.equal(host.calls.length, 1);
        assert.equal(JSON.parse(host.calls[0]!.body).events.length, 20);
        assert.ok(new TextEncoder().encode(host.calls[0]!.body).length <= 16384);
      } finally { client.destroy(); }
    }
  });
}

test('legacy custom hosts can omit the optional monotonic clock', async () => {
  const host = new FakeBrowser(); Reflect.deleteProperty(host, 'monotonicNow');
  const client = host.client();
  try { client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0); assert.equal(host.calls.length, 1); }
  finally { client.destroy(); }
});

async function bundled(entry: string) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url))],
    bundle: true, write: false, minify: true, mangleProps: /^__tfBatch/, format: 'esm', platform: 'browser', target: 'es2022' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'));
}
