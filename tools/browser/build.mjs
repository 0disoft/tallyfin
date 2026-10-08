import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
await build({ entryPoints: [fileURLToPath(new URL('packages/browser/src/index.ts', root))],
  outfile: fileURLToPath(new URL('packages/browser/dist/index.js', root)), bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true });
