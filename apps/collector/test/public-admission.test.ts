import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorker } from '../src/index.ts';
import { createCollector } from '../src/handler.ts';
import { setup, now, registry } from '../../../packages/storage-d1/test/helpers.ts';
import type { SqlDatabase } from '@tallyfin/storage-d1';
const url = 'https://collector.example.invalid/v1/projects/sembom/batches';
const unusedDb: SqlDatabase = { prepare() { throw Error('DB must not be touched'); }, batch() { throw Error('DB must not be touched'); } };
test('public limiter blocks before any database access and leaves server authentication first', async () => {
  const keys: string[] = [];
  const bindings = { DB: unusedDb, BROWSER_INGEST_LIMITER: { async limit({ key }: { key: string }) { keys.push(key); return { success: false }; } } };
  const worker = createWorker();
  const response = await worker.fetch(new Request(url, { method: 'POST', body: '{}' }), bindings);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
  assert.deepEqual(keys, ['tallyfin-browser:sembom']);
  const server = await worker.fetch(new Request(url.replace('/batches', '/server-batches'), { method: 'POST' }), bindings);
  assert.equal(server.status, 401); assert.equal(keys.length, 1);
  const failed = await worker.fetch(new Request(url, { method: 'POST' }), { DB: unusedDb,
    BROWSER_INGEST_LIMITER: { async limit() { throw Error('private limiter failure'); } } });
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private limiter failure'));
});
test('an unresolved public limiter respects cancellation and deadlines without submitting a DB operation', async () => {
  for (const mode of ['abort', 'deadline']) {
    const controller = new AbortController(); let enter!: () => void, release!: (value: { success: boolean }) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const response = createWorker(undefined, undefined, { requestTimeoutMs: mode === 'deadline' ? 5 : 15000 }).fetch(new Request(url, { signal: controller.signal }), { DB: unusedDb,
      BROWSER_INGEST_LIMITER: { limit() { enter(); return new Promise(resolve => { release = resolve; }); } } });
    await entered;
    try { if (mode === 'abort') controller.abort(Error('cancelled')); assert.equal((await response).status, 503); }
    finally { release({ success: true }); }
  }
});
test('denied origins cannot write counters or exhaust the next valid request quota', async () => {
  const f = await setup();
  try {
    await f.db.prepare('UPDATE projects SET requests_per_minute=1').run();
    const observations: unknown[] = [];
    const handler = createCollector(f.store, { now: () => now, observe: value => observations.push(value) });
    for (let n = 0; n < 4; n++) assert.equal((await handler(new Request(url, { method: 'POST', headers: { Origin: 'https://denied.example.invalid' }, body: '{}' }))).status, 403);
    assert.equal(await f.db.prepare('SELECT count(*) FROM ingest_minute_usage').first('count(*)'), 0);
    const preflight = () => new Request(url, { method: 'OPTIONS', headers: { Origin: registry.allowedOrigins[0]!, 'Access-Control-Request-Method': 'POST' } });
    assert.equal((await handler(preflight())).status, 204);
    assert.equal((await handler(preflight())).status, 429);
    assert.equal(observations.length, 6);
  } finally { await f.mf.dispose(); }
});
