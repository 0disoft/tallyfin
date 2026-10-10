import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparedInstallation } from '../../../tools/runtime/prepared-installation.ts';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run admin:build-configured -- --dir <prepared-installation-directory>\nRevalidates all installation files, ignores ambient VITE_ and .env values, and builds into new admin-assets only. No upload or provider contact.');
  } else {
    if (args.length !== 2 || args[0] !== '--dir' || !args[1] || args[1].startsWith('--')) throw Error();
    const directory = resolve(args[1]);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const app = fileURLToPath(new URL('../', import.meta.url));
    const plan = await preparedInstallation(directory, root);
    const outDir = plan.admin.assets.directory;
    // Keep prior or partially built artifacts intact: prepare a new installation to rebuild.
    await mkdir(outDir, { mode: 0o700 });
    process.env.NODE_ENV = 'production';
    const define = Object.fromEntries(Object.entries(plan.loginSettings.env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
    await build({ root: app, configFile: join(app, 'vite.config.mjs'), mode: 'production',
      envDir: false, envPrefix: [], define, build: { outDir, emptyOutDir: false }, logLevel: 'warn' });
    await writeFile(join(directory, 'admin-build.json'), JSON.stringify({ schemaVersion: 'tallyfin.admin-build/v1',
      assetsDirectory: outDir, origin: plan.loginSettings.origin, builtAt: new Date().toISOString(), remoteChanges: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ built: true, remoteChanges: false, assetsDirectory: outDir }));
  }
} catch {
  console.error(JSON.stringify({ code: 'configured_admin_build_failed', message: 'Check an intact installation directory and absent admin-assets. Prepare a new installation to rebuild. Use --help.' }));
  process.exitCode = 1;
}
