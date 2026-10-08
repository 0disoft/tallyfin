import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { projectBrowserSchema } from './schema.mjs';

const root = new URL('../../', import.meta.url);
const readJson = path => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
assert.deepEqual(readJson('examples/sembom/browser-schema.json'), projectBrowserSchema(readJson('api/examples/registry.json')));
const sizes = {};
for (const [name, entry] of Object.entries({ sdk: 'packages/browser/src/index.ts', sdkWithSembom: 'examples/sembom/browser.ts' })) {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL(entry, root))], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true });
  const bytes = bundle.outputFiles[0].contents;
  assert.ok(Object.values(bundle.metafile.outputs).every(output => output.imports.length === 0), 'runtime imports remain');
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => /(?:node_modules|packages\/(?:core|storage-d1)|apps\/)/.test(path.replaceAll('\\', '/'))), 'server or external runtime code entered the browser bundle');
  sizes[name] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}
console.log(JSON.stringify({ budgetGzipBytes: 3072, ...sizes }, null, 2));
assert.ok(sizes.sdkWithSembom.gzipBytes <= 3072, 'SDK + integration + required schema exceeds the 3 KiB budget');
