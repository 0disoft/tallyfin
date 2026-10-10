import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
await build({ entryPoints: ['index', 'funnels'].map(name => fileURLToPath(new URL(`packages/browser/src/${name}.ts`, root))),
  outdir: fileURLToPath(new URL('packages/browser/dist/', root)), bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true });
