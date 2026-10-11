import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTallyfin } from '../src/index.ts';
import { createTallyfinFunnels } from '../src/funnels.ts';
import { FakeBrowser, endpoint, schema } from './helpers.ts';

for (const profile of ['index', 'funnels'] as const) test(`minified ${profile} profile preserves public wire keys, linked identities and identical retries`, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL(`../src/${profile}.ts`, import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', minify: true,
    mangleProps: /^__tfBatch/, mangleCache: {} });
  assert.equal(Object.keys(bundle.mangleCache!).length, 6);
  assert.ok(Object.keys(bundle.mangleCache!).every(key => key.startsWith('__tfBatch')));
  const module = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.contents).toString('base64'));
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  async function trace(factory: typeof createTallyfin | typeof createTallyfinFunnels) {
    const host = new FakeBrowser(); let next = 0;
    host.uuid = () => ids[next++]!;
    host.reply = async index => ({ status: index === 0 ? 502 : 200, retryAfter: null });
    const options = { endpoint, schema: profile === 'index' ? schema : { version: 1, events: { first: {}, second: {} },
      funnels: { task: { steps: ['first', 'second'], dimensions: [] } } } };
    const client = factory(options as any, host) as any;
    if (profile === 'index') {
      const handle = client.start('conversion', { tool: 'loan' });
      host.time += 50; assert.equal(handle.succeed(), true);
    } else {
      const run = client.createFunnelRun('task'); assert.equal(client.trackFunnel('first', {}, run), true);
      host.time += 50; assert.equal(client.trackFunnel('second', {}, run), true);
    }
    client.flush(); await host.tick(1000);
    assert.equal(host.calls.length, 2); assert.equal(host.calls[0]!.body, host.calls[1]!.body);
    assert.equal(client.pending, 0); client.destroy(); assert.equal(host.timers.size, 0); assert.equal(host.listeners.size, 0);
    return host.calls[0]!.body;
  }
  const source = profile === 'index' ? createTallyfin : createTallyfinFunnels;
  assert.equal(await trace(module[profile === 'index' ? 'createTallyfin' : 'createTallyfinFunnels']), await trace(source));
});
