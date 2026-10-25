import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createWorker } from '../src/index.ts';
import { createCollector } from '../src/handler.ts';
import { setup, batch, now, registry } from '../../../packages/storage-d1/test/helpers.ts';
import type { SqlDatabase } from '@tallyfin/storage-d1';
const url = 'https://collector.example.invalid/v1/projects/sembom/batches';
let databaseCalls = 0;
const unusedDb: SqlDatabase = { prepare() { databaseCalls++; throw Error('DB must not be touched'); },
  batch() { databaseCalls++; throw Error('DB must not be touched'); } };
afterEach(() => { assert.equal(databaseCalls, 0, 'rejected admission must not touch D1'); });

test('required or invalid limiter configuration and malformed replies fail closed without DB access', async () => {
  const worker = createWorker();
  for (const flag of ['true', '', 'yes', ' true']) {
    const response = await worker.fetch(new Request(url, { method: 'POST' }),
      { DB: unusedDb, BROWSER_INGEST_LIMITER_REQUIRED: flag });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'storage_unavailable');
  }
  for (const success of [undefined, null, 0, 'true']) {
    const response = await worker.fetch(new Request(url, { method: 'POST' }), { DB: unusedDb,
      BROWSER_INGEST_LIMITER_REQUIRED: 'true', BROWSER_INGEST_LIMITER: {
        async limit() { return JSON.parse(JSON.stringify({ success })); },
      } });
    assert.equal(response.status, 503);
  }
  const server = await worker.fetch(new Request(url.replace('/batches', '/server-batches'), { method: 'POST' }),
    { DB: unusedDb, BROWSER_INGEST_LIMITER_REQUIRED: 'true' });
  assert.equal(server.status, 401);
});

test('allowed preflight, a full delivery and its replay retain quotas and exact counts; denied burst skips D1', async () => {
  const f = await setup();
  try {
    let calls = 0, admissions = 0;
    const db: SqlDatabase = { prepare: query => f.db.prepare(query), async batch<T>(statements) {
      calls++; return f.db.batch<T>(statements as Parameters<typeof f.db.batch>[0]);
    } };
    const worker = createWorker();
    const bindings = { DB: db, BROWSER_INGEST_LIMITER_REQUIRED: 'true', BROWSER_INGEST_LIMITER: {
      async limit({ key }: { key: string }) { assert.equal(key, 'tallyfin-browser:sembom'); return { success: ++admissions <= 3 }; },
    } };
    const origin = registry.allowedOrigins[0]!;
    assert.equal((await worker.fetch(new Request(url, { method: 'OPTIONS', headers: { Origin: origin,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), bindings)).status, 204);
    const input = batch(), shift = Date.now() - now;
    input.events = Array.from({ length: 20 }, () => {
      const event = { ...input.events[0], eventId: crypto.randomUUID(), name: 'tool_view' };
      delete event.attempt; return event;
    });
    for (const event of input.events) {
      event.occurredAt = new Date(Date.parse(event.occurredAt) + shift).toISOString();
      if (event.attempt) event.attempt.startedAt = new Date(Date.parse(event.attempt.startedAt) + shift).toISOString();
    }
    const send = () => worker.fetch(new Request(url, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(input) }), bindings);
    assert.deepEqual(await (await send()).json(), { accepted: 20, duplicates: 0 });
    assert.deepEqual(await (await send()).json(), { accepted: 0, duplicates: 20 });
    const before = calls;
    assert.equal((await send()).status, 429);
    assert.equal(calls, before);
    assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 20);
    assert.equal(await f.db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), 20);
    assert.equal(await f.db.prepare('SELECT sum(request_count) AS n FROM ingest_minute_usage').first('n'), 3);
  } finally { await f.mf.dispose(); }
});
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


test('unresolved limiter calls cannot consume database capacity for authenticated administrator reads', async () => {
  const pending: ((value: { success: boolean }) => void)[] = []; let enter!: () => void, dbCalls = 0;
  const worker = createWorker(async () => ({ issuer: 'https://issuer.example.invalid', subject: 'operator' }), undefined,
    { maxDatabaseOperations: 2, maxPublicOperations: 2 });
  const bindings = { DB: {
    prepare() { return { bind() { return this; } }; },
    async batch(statements: unknown[]) { dbCalls++; return statements.map(() => ({ success: true, results: [], meta: { changes: 0 } })); },
  }, BROWSER_INGEST_LIMITER: { limit() { enter(); return new Promise<{ success: boolean }>(resolve => pending.push(resolve)); } } };
  const admin = () => worker.fetch(new Request('https://collector.example.invalid/v1/projects', { headers: { Authorization: 'Bearer synthetic-test' } }), bindings);
  assert.equal((await admin()).status, 200);
  try {
    for (let n = 0; n < 2; n++) {
      const ready = new Promise<void>(resolve => { enter = resolve; }), controller = new AbortController();
      const response = worker.fetch(new Request(url, { method: 'POST', signal: controller.signal }), bindings);
      await ready; controller.abort(); assert.equal((await response).status, 503);
    }
    const before = dbCalls;
    assert.equal((await worker.fetch(new Request(url), bindings)).status, 503);
    assert.equal(dbCalls, before);
    assert.equal((await admin()).status, 200); assert.ok(dbCalls > before);
  } finally { for (const resolve of pending) resolve({ success: true }); }
});
