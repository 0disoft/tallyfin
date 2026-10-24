import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';

test('SQLite alarm is idempotently armed, invokes private Collector RPC, expires auth keys, and reschedules through failure', async () => {
  const bundle = await build({ stdin: { contents: `
    import {MaintenanceClock} from './maintenance.ts';
    export class TestClock extends MaintenanceClock { async tick(){ await this.alarm(); return this.status() } }
    export default { async fetch(request,env){ const clock=env.MAINTENANCE.getByName('installation');
      const op=new URL(request.url).pathname.slice(1); return Response.json(await clock[op]()); } };`,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), sourcefile: 'test-clock.ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), workers: [
    { name: 'auth', modules: [{ type: 'ESModule', path: 'clock.mjs', contents: bundle.outputFiles[0]!.text }], compatibilityDate: '2026-07-30',
      d1Databases: ['AUTH_DB'], bindings: { MAINTAIN_COLLECTOR: 'true' },
      durableObjects: { MAINTENANCE: { className: 'TestClock', useSQLite: true } },
      serviceBindings: { COLLECTOR_MAINTENANCE: { name: 'collector', entrypoint: 'CollectorMaintenance' } } },
    { name: 'collector', modules: true, compatibilityDate: '2026-07-30', script: `
      import {WorkerEntrypoint} from 'cloudflare:workers'; let fail=false, calls=0;
      export class CollectorMaintenance extends WorkerEntrypoint { async run(){calls++; if(fail)throw Error('dependency failed')} }
      export default {fetch(r){fail=new URL(r.url).pathname==='/fail';return Response.json({calls})}};` },
  ] });
  try {
    const db = await mf.getD1Database('AUTH_DB', 'auth');
    await db.exec('CREATE TABLE rateLimit(id TEXT PRIMARY KEY, lastRequest INTEGER)');
    await db.batch([db.prepare('INSERT INTO rateLimit VALUES(?,?)').bind('expired', Date.now() - 172800000),
      db.prepare('INSERT INTO rateLimit VALUES(?,?)').bind('current', Date.now())]);
    const clock = await mf.getWorker('auth'), collector = await mf.getWorker('collector');
    const call = async (op: string) => (await clock.fetch('https://test.invalid/' + op)).json() as Promise<{ nextAt: number; lastRun: { succeeded: boolean } | null }>;
    const started = await call('start'); assert.ok(started.nextAt > Date.now());
    const repeated = await Promise.all([call('start'), call('start')]);
    assert.ok(repeated.every(row => row.nextAt === started.nextAt));
    const success = await call('tick'); assert.equal(success.lastRun!.succeeded, true);
    assert.ok(success.nextAt > Date.now() + 50000);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM rateLimit').first())!.n, 1);
    await collector.fetch('https://test.invalid/fail');
    const failed = await call('tick'); assert.equal(failed.lastRun!.succeeded, false); assert.ok(failed.nextAt > Date.now() + 50000);
    await collector.fetch('https://test.invalid/recover');
    const recovered = await call('tick'); assert.equal(recovered.lastRun!.succeeded, true);
    assert.ok((await (await collector.fetch('https://test.invalid/status')).json() as { calls: number }).calls >= 3);
  } finally { await mf.dispose(); }
});
