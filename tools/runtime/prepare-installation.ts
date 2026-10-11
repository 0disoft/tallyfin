import { open, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installation, InstallationConfigError } from './installation.ts';

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
    const output = resolve(options.get('--out')!);
    const plan = installation(input, fileURLToPath(new URL('../../', import.meta.url)), output);
    const artifacts = [
      ['collector.wrangler.json', plan.collector], ['admin.wrangler.json', plan.admin],
      ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration],
      ['installation.json', plan.manifest],
    ] as const;
    await mkdir(dirname(output), { recursive: true });
    await mkdir(output, { mode: 0o700 }); // Exclusive: never modify or remove an existing directory.
    const written: string[] = [];
    try {
      for (const [name, value] of artifacts) {
        const path = join(output, name);
        await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); written.push(path);
      }
    } catch (error) {
      // Only remove files written by this invocation; rmdir refuses nonempty directories.
      for (const path of written) await unlink(path).catch(() => {});
      await rmdir(output).catch(() => {}); throw error;
    }
    console.log(JSON.stringify({ prepared: true, remoteChanges: false, output, files: artifacts.map(([name]) => name) }));
  }
} catch (error) {
  console.error(JSON.stringify({ code: 'installation_config_failed',
    message: 'Check matching targets, HTTPS origin, public OIDC settings and a new output directory. Use --help.',
    ...(error instanceof InstallationConfigError ? { field: error.field } : {}) }));
  process.exitCode = 1;
}
