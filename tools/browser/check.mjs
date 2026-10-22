import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { projectBrowserSchema, projectFunnelBrowserSchema } from './schema.mjs';
import { sdkSetup } from '../../apps/admin/src/api/sdk-setup.ts';

const root = new URL('../../', import.meta.url);
const readJson = path => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
assert.deepEqual(readJson('examples/sembom/browser-schema.json'), projectBrowserSchema(readJson('api/examples/registry.json')));
assert.deepEqual(readJson('examples/funnels/browser-schema.json'), projectFunnelBrowserSchema(readJson('api/examples/funnel-registry.json')));
const sizes = {};
for (const [name, entry] of Object.entries({ sdk: 'packages/browser/src/index.ts', sdkWithSembom: 'examples/sembom/browser.ts',
  funnelSdk: 'packages/browser/src/funnels.ts', sdkWithFunnel: 'examples/funnels/browser.ts',
  sdkWithGeneratedFunnel: { stdin: {
    contents: sdkSetup(readJson('api/examples/funnel-registry.json'), 'https://collector.example.invalid', 'browser', { profile: 'funnels' }),
    loader: 'ts', resolveDir: fileURLToPath(root),
  }, plugins: [{ name: 'local-sdk-source', setup(builder) {
    builder.onResolve({ filter: /^@tallyfin\/browser\/funnels$/ }, () => ({
      path: fileURLToPath(new URL('packages/browser/src/funnels.ts', root)),
    }));
  } }] },
})) {
  const input = typeof entry === 'string' ? { entryPoints: [fileURLToPath(new URL(entry, root))] } : entry;
  const bundle = await build({ ...input, bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true, mangleProps: /^__tfBatch/ });
  const bytes = bundle.outputFiles[0].contents;
  assert.ok(Object.values(bundle.metafile.outputs).every(output => output.imports.length === 0), 'runtime imports remain');
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => /(?:node_modules|packages\/(?:core|storage-d1)|apps\/)/.test(path.replaceAll('\\', '/'))), 'server or external runtime code entered the browser bundle');
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => path.replaceAll('\\', '/').endsWith(['sdk', 'sdkWithSembom'].includes(name)
    ? 'packages/browser/src/funnels.ts' : 'packages/browser/src/index.ts')), 'another task profile entered the bundle');
  sizes[name] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}
console.log(JSON.stringify({ budgetGzipBytes: 3328, standaloneBudgetGzipBytes: 3072, ...sizes }, null, 2));
assert.ok(sizes.sdkWithSembom.gzipBytes <= 3328, 'SDK + integration + required schema exceeds the 3.25 KiB integration budget');
assert.ok(sizes.sdkWithFunnel.gzipBytes <= 3328, 'Funnel SDK + integration + required schema exceeds the 3.25 KiB integration budget');
assert.ok(sizes.sdkWithGeneratedFunnel.gzipBytes <= 3328, 'Generated funnel SDK + endpoint + required schema exceeds the 3.25 KiB integration budget');

assert.ok(sizes.sdk.gzipBytes <= 3072 && sizes.funnelSdk.gzipBytes <= 3072, 'Standalone SDK exceeds the 3 KiB budget');
