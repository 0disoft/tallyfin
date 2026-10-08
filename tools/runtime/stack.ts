import { fileURLToPath } from 'node:url';
import { supervise } from './supervise.ts';

const args = process.argv.slice(2);
const abort = new AbortController();
const shutdown = () => abort.abort();
try {
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run dev -- --local --state-dir <initialized-directory> [--settings <collector-json>] [--admin-port <port>] [--collector-port <port>]');
  } else {
    if (args.shift() !== '--local') throw Error();
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i]!; const value = args[i + 1];
      if (!['--state-dir', '--settings', '--admin-port', '--collector-port'].includes(flag) || options.has(flag) || !value || value.startsWith('--')) throw Error();
      options.set(flag, value);
    }
    const state = options.get('--state-dir');
    const admin = options.get('--admin-port') ?? '5180'; const collector = options.get('--collector-port') ?? '5188';
    if (!state || [admin, collector].some(port => !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) || Number(admin) === Number(collector)) throw Error();
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const origin = `http://127.0.0.1:${Number(collector)}`;
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    // IPC shutdown also lets supervised tests and parent tools close the entire stack.
    process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown') shutdown(); });
    if (process.send) process.once('disconnect', shutdown);
    await supervise([
      { cwd: root, args: ['tools/runtime/dev.ts', '--local', '--state-dir', state, '--port', collector,
        ...(options.has('--settings') ? ['--settings', options.get('--settings')!] : [])] },
      { cwd: root, args: ['prototypes/admin/scripts/dev-local.mjs', '--port', admin],
        env: { ...process.env, TALLYFIN_COLLECTOR_ORIGIN: origin } },
    ], servers => {
      if (servers[0]?.url !== origin || servers[1]?.url !== `http://127.0.0.1:${Number(admin)}`) throw Error();
      const ready = { type: 'ready', local: true, admin: servers[1].url, collector: origin };
      console.log(JSON.stringify(ready)); process.send?.(ready);
    }, abort.signal);
  }
} catch {
  if (!abort.signal.aborted) {
    console.error(JSON.stringify({ code: 'stack_start_failed', message: 'Check initialized DB, settings, free ports and frontend dependencies. Use --help.' }));
    process.exitCode = 1;
  }
} finally {
  process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
  if (process.connected) process.disconnect();
}
