import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTallyfin } from '../src/index.ts';
import { createTallyfinFunnels } from '../src/funnels.ts';
import { endpoint, FakeBrowser } from './helpers.ts';

for (const bundled of [false, true]) {
  for (const profile of ['workflows', 'funnels'] as const) {
    test(`${profile} ${bundled ? 'minified' : 'source'} rejects non-object definition maps before attaching listeners`, async () => {
      let create: typeof createTallyfin | typeof createTallyfinFunnels = profile === 'workflows' ? createTallyfin : createTallyfinFunnels;
      if (bundled) {
        const entry = profile === 'workflows' ? '../src/index.ts' : '../src/funnels.ts';
        const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
          bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022' });
        const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.contents).toString('base64')}`);
        create = profile === 'workflows' ? module.createTallyfin : module.createTallyfinFunnels;
      }
      const definition = () => ({ version: 1, events: { view: {}, started: {}, succeeded: {} },
        ...(profile === 'workflows' ? { workflows: {} } : { funnels: { task: { steps: ['started', 'succeeded'], dimensions: [] } } }) });
      for (const malformed of [[], 0, false, '', null]) {
        for (const field of ['properties', 'events', ...(profile === 'workflows' ? ['workflows'] : [])]) {
          const schema: any = definition();
          if (field === 'properties') schema.events.view = malformed;
          else schema[field] = malformed;
          const host = new FakeBrowser();
          const client = create({ endpoint, schema }, host);
          try {
            assert.equal(client.track('view'), false, `${field}: ${JSON.stringify(malformed)}`);
            assert.equal(host.listeners.size, 0, `${field}: no visibility listener`);
            client.flush(); host.hidden(); await host.tick(10000);
            assert.equal(client.pending, 0); assert.equal(host.timers.size, 0);
            assert.equal(host.calls.length, 0); assert.equal(host.beacons.length, 0);
          } finally { client.destroy(); }
        }
      }
      const host = new FakeBrowser(), client = create({ endpoint, schema: definition() as any }, host);
      try {
        assert.equal(client.track('view'), true, 'empty object is a valid no-property event');
        assert.equal(host.listeners.size, 1);
        client.flush(); await host.tick(0); assert.equal(host.calls.length, 1);
      } finally { client.destroy(); }
    });
  }
}
