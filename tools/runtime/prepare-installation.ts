import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InstallationConfigError } from './installation.ts';
import { writeInstallation } from './write-installation.ts';

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run install:prepare -- --file <installation-json> --out <new-directory>\nChecks matching admin/collector account, service, HTTPS origin and OIDC issuer. Writes local configs and public login settings only. No upload, login, migration, grant or provider registration.');
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
      if ((await file.stat()).size > 32768) throw Error();
      const bytes = await file.readFile(); if (bytes.byteLength > 32768) throw Error();
      input = JSON.parse(bytes.toString('utf8'));
    } finally { await file.close(); }
    console.log(JSON.stringify(await writeInstallation(input, fileURLToPath(new URL('../../', import.meta.url)), options.get('--out')!)));
  }
} catch (error) {
  console.error(JSON.stringify({ code: 'installation_config_failed',
    message: 'Check matching targets, HTTPS origin, public OIDC settings and a new output directory. Use --help.',
    ...(error instanceof InstallationConfigError ? { field: error.field } : {}) }));
  process.exitCode = 1;
}
