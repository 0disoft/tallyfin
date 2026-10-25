import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { DEFAULT_SETTINGS, configureCollector } from '../../apps/collector/src/config.ts';
import type { Settings } from '../../apps/collector/src/config.ts';
import { initialize } from '../provision/local.ts';

export async function startLocal(stateDir: string, settings: Settings = DEFAULT_SETTINGS, port = 5188) {
  configureCollector(settings); // Validate before creating files or opening a listener; no key fetch.
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../apps/collector/src/runtime.ts', import.meta.url))],
    bundle: true, external: ['cloudflare:workers'], write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-08-06', host: '127.0.0.1', port,
    d1Databases: { DB: 'tallyfin-local' }, d1Persist: resolve(stateDir), bindings: settings,
    log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB');
    const missing = await initialize(db, false);
    if (missing.migrations.length) throw Error('Initialize the local DB using provision init --apply first');
    const url = await mf.ready;
    let pending: Promise<void> | undefined;
    let closed = false;
    const runCleanup = async () => {
      try {
        const worker = await mf.getWorker();
        if (!('scheduled' in worker) || typeof worker.scheduled !== 'function') throw Error();
        const outcome = await worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' });
        if (outcome.outcome !== 'ok') throw Error();
      } catch { console.warn(JSON.stringify({ code: 'local_retention_cleanup_failed' })); }
    };
    const cleanup = () => {
      if (closed) return Promise.resolve();
      return pending ??= runCleanup().finally(() => { pending = undefined; });
    };
    const timer = setInterval(() => { void cleanup(); }, 60_000);
    return { mf, db, url, cleanup, close: async () => {
      closed = true; clearInterval(timer); await pending; await mf.dispose();
    } };
  } catch (error) { await mf.dispose(); throw error; }
}
