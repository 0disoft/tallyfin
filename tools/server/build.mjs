import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { cleanSdkOutput } from '../sdk/output.mjs';
const root = new URL('../../', import.meta.url);
const result = await build({ entryPoints: [fileURLToPath(new URL('packages/server/src/index.ts', root))],
  absWorkingDir: fileURLToPath(root),
  outfile: fileURLToPath(new URL('packages/server/dist/index.js', root)), bundle: true,
  format: 'esm', platform: 'neutral', target: 'es2023', minify: true, metafile: true, write: false });
assert.ok(Object.values(result.metafile.outputs).every(output => output.imports.length === 0), 'Runtime imports remain');
assert.ok(Object.keys(result.metafile.inputs).every(path => path.replaceAll('\\', '/').includes('packages/server/src/')), 'External runtime code entered the server SDK');
const { mkdir, writeFile } = await import('node:fs/promises');
const outdir = await cleanSdkOutput('server');
await mkdir(outdir, { recursive: true });
await writeFile(new URL('packages/server/dist/index.js', root), result.outputFiles[0].contents);
console.log(JSON.stringify({ serverSdk: { bytes: result.outputFiles[0].contents.length, gzipBytes: gzipSync(result.outputFiles[0].contents).length }, runtimeDependencies: 0 }));
