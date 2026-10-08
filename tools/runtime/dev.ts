import { readFile } from 'node:fs/promises';
import { startLocal } from './local.ts';
import { DEFAULT_SETTINGS } from '../../apps/collector/src/config.ts';

const args = process.argv.slice(2);
const options = new Map<string, string>();
try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run collector:dev -- --local --state-dir <directory> [--settings <json>] [--port <port>]');
  } else {
    if (args.shift() !== '--local') throw Error();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]!; const value = args[i + 1];
      if (!['--state-dir', '--settings', '--port'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw Error();
      options.set(key, value);
    }
    if (!options.get('--state-dir')) throw Error();
    const port = options.get('--port') ?? '5188';
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error();
    const settings: unknown = options.has('--settings') ? JSON.parse(await readFile(options.get('--settings')!, 'utf8')) : DEFAULT_SETTINGS;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      Object.keys(settings).some(key => !(key in DEFAULT_SETTINGS))) throw Error();
    const local = await startLocal(options.get('--state-dir')!, { ...DEFAULT_SETTINGS, ...settings }, Number(port));
    console.log(JSON.stringify({ local: true, url: local.url.origin, cleanupIntervalSeconds: 60 }));
    let closing = false;
    const close = () => {
      if (closing) return; closing = true;
      void local.close().catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  }
} catch {
  console.error(JSON.stringify({ code: 'local_start_failed', message: 'Check arguments, settings and initialized DB. Use --help.' }));
  process.exitCode = 1;
}
