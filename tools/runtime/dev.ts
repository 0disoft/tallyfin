import { readFile } from 'node:fs/promises';
import { startLocal } from './local.ts';
import { DEFAULT_SETTINGS } from '../../apps/collector/src/config.ts';

const args = process.argv.slice(2);
const options = new Map<string, string>();
let stopping = false;
let local: Awaited<ReturnType<typeof startLocal>> | undefined;
let closing: Promise<void> | undefined;
async function close() {
  stopping = true;
  if (local) await (closing ??= local.close());
  if (process.connected) process.disconnect();
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown') void close(); });
if (process.send) process.once('disconnect', () => { void close(); });
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
      Object.keys(settings).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw Error();
    local = await startLocal(options.get('--state-dir')!, { ...DEFAULT_SETTINGS, ...settings }, Number(port));
    if (stopping) await close();
    else {
      const ready = { type: 'ready', local: true, url: local.url.origin, cleanupIntervalSeconds: 60 };
      console.log(JSON.stringify(ready)); process.send?.(ready);
    }
  }
} catch {
  console.error(JSON.stringify({ code: 'local_start_failed', message: 'Check arguments, settings and initialized DB. Use --help.' }));
  process.exitCode = 1;
  await close();
}
