import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparedInstallation } from './prepared-installation.ts';
import { authDeploymentTarget } from './auth-target.ts';

export async function prepareAuth(argv: string[]) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) {
    console.log('npm run auth:prepare -- --dir <prepared-installation> --file <auth-target.json>\nWrites auth.wrangler.json exclusively; no credentials or remote changes.'); return;
  }
  if (argv.length !== 4 || argv[0] !== '--dir' || !argv[1] || argv[2] !== '--file' || !argv[3]) throw Error('Invalid arguments');
  const root = fileURLToPath(new URL('../../', import.meta.url)), output = resolve(argv[1]);
  const plan = await preparedInstallation(output, root);
  const bytes = await readFile(argv[3]); if (bytes.byteLength > 8192) throw Error('Invalid authentication target');
  const config = authDeploymentTarget(JSON.parse(bytes.toString('utf8')), plan, root);
  await writeFile(resolve(output, 'auth.wrangler.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ prepared: true, remoteChanges: false, file: resolve(output, 'auth.wrangler.json') }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  prepareAuth(process.argv.slice(2)).catch(() => { console.error('Authentication configuration preparation failed'); process.exitCode = 1; });
