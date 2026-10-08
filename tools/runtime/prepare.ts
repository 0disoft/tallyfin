import { open, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentTarget } from './target.ts';

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run collector:config -- --file <target-json> --out <new-wrangler-json>\nValidates supplied settings and writes a new local file only. No upload, login, migration or resource creation.');
  } else {
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]!; const value = args[i + 1];
      if (!['--file', '--out'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw Error();
      options.set(key, value);
    }
    if (!options.has('--file') || !options.has('--out')) throw Error();
    const file = await open(options.get('--file')!, 'r');
    let input: unknown;
    try {
      if ((await file.stat()).size > 8192) throw Error();
      const bytes = await file.readFile();
      if (bytes.byteLength > 8192) throw Error();
      input = JSON.parse(bytes.toString('utf8'));
    } finally { await file.close(); }
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const target = deploymentTarget(input, root);
    const output = resolve(options.get('--out')!);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(target, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ prepared: true, remoteChanges: false, output }));
  }
} catch {
  console.error(JSON.stringify({ code: 'target_config_failed', message: 'Check target fields, OIDC settings and a new output path. Use --help.' }));
  process.exitCode = 1;
}
