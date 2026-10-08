import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { collectorOrigin } from './local-proxy.mjs';

let server;
let stopping = false;
let closing;
async function stop() {
  stopping = true;
  if (server) await (closing ??= server.close());
  if (process.connected) process.disconnect();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
process.on('message', message => { if (message?.type === 'shutdown') void stop(); });
process.once('disconnect', () => { void stop(); });
try {
  const [flag, port, ...extra] = process.argv.slice(2);
  if (flag !== '--port' || extra.length || !/^\d{1,5}$/.test(port ?? '') || Number(port) < 1 || Number(port) > 65535) throw Error();
  collectorOrigin(process.env.TALLYFIN_COLLECTOR_ORIGIN);
  const root = fileURLToPath(new URL('../', import.meta.url));
  server = await createServer({ root, configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)),
    server: { host: '127.0.0.1', port: Number(port), strictPort: true, open: false }, logLevel: 'warn' });
  if (stopping) await stop();
  else {
    await server.listen();
    if (stopping) await stop();
    else process.send?.({ type: 'ready', url: `http://127.0.0.1:${port}` });
  }
} catch {
  process.exitCode = 1;
  console.error(JSON.stringify({ code: 'admin_start_failed', message: 'Check frontend dependencies, proxy target and port.' }));
  await stop();
}
