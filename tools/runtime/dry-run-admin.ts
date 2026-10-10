import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run admin:dry-run -- [--config <wrangler-json>] [--outdir <local-directory>]\nRuns installed Wrangler deploy --dry-run only. No upload or resource creation.');
  } else {
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]!; const value = args[i + 1];
      if (!['--config', '--outdir'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw Error();
      options.set(key, value);
    }
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const config = resolve(options.get('--config') ?? resolve(root, 'apps/admin/wrangler.jsonc'));
    const outdir = resolve(options.get('--outdir') ?? resolve(root, '.tmp/admin-worker-bundle'));
    const result = await promisify(execFile)(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy', '--config', config, '--dry-run', '--outdir', outdir], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 30000 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  }
} catch {
  console.error(JSON.stringify({ code: 'admin_dry_run_failed', message: 'Check the selected config, built assets and installed Wrangler. Only --config and --outdir are accepted.' }));
  process.exitCode = 1;
}
