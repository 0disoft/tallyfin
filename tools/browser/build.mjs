import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { cleanSdkOutput } from '../sdk/output.mjs';
const root = new URL('../../', import.meta.url);
const outdir = await cleanSdkOutput('browser');
await build({ entryPoints: ['index', 'funnels'].map(name => fileURLToPath(new URL(`packages/browser/src/${name}.ts`, root))),
  outdir, bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, mangleProps: /^__tfBatch/ });
