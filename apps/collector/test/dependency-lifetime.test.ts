import assert from 'node:assert/strict';
import { test } from 'node:test';
import { databaseCapacity, requestDatabase } from '../src/dependency-lifetime.ts';
import { createWorker } from '../src/index.ts';
import type { SqlDatabase } from '@tallyfin/storage-d1';

test('cancellation keeps real DB capacity occupied until late I/O settles without replay', async () => {
  const capacity = databaseCapacity(1), parent = new AbortController(), cause = new Error('caller stopped');
  let finish!: (value: never[]) => void, calls = 0;
  const db = { batch() { calls++; return new Promise(resolve => { finish = resolve; }); } } as unknown as SqlDatabase;
  const first = requestDatabase(db, parent.signal, capacity);
  const pending = first.db.batch([]); parent.abort(cause);
  await assert.rejects(pending, error => error === cause); first.close();
  const other = requestDatabase(db, new AbortController().signal, capacity);
  try {
    await assert.rejects(other.db.batch([]), { code: 'storage_unavailable' }); assert.equal(calls, 1);
    finish([]); await new Promise(resolve => setImmediate(resolve));
    const next = other.db.batch([]); finish([]); assert.deepEqual(await next, []); assert.equal(calls, 2);
  } finally { other.close(); }
});

test('one deadline spans database stages and prevents new writes after timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let at = 0, calls = 0;
  const db = { async batch() { calls++; return []; } } as unknown as SqlDatabase;
  const scope = requestDatabase(db, new AbortController().signal, databaseCapacity(), 100, () => at);
  try {
    assert.deepEqual(await scope.db.batch([]), []);
    at = 100; // Even if the timer has not run yet, no new operation may start.
    await assert.rejects(scope.db.batch([]), { code: 'storage_unavailable' }); assert.equal(calls, 1);
  } finally { scope.close(); }
});

test('deadline stays attached to background diagnostic I/O after handler returns', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scope = requestDatabase({ batch: () => new Promise(() => {}) } as unknown as SqlDatabase,
    new AbortController().signal, databaseCapacity(), 100);
  const pending = scope.db.batch([]), rejected = assert.rejects(pending, { code: 'storage_unavailable' });
  scope.close(); t.mock.timers.tick(100); await rejected;
});

test('worker bounds stalled authentication before DB access and exposes no internal cause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const worker = createWorker(async () => new Promise(() => {}), undefined, { requestTimeoutMs: 100 });
  const pending = worker.fetch(new Request('https://collector.example.invalid/v1/health', { headers: { Authorization: 'Bearer fixture' } }),
    { DB: { prepare() { calls++; throw Error('Unexpected DB call'); }, batch: async () => [] } });
  t.mock.timers.tick(100);
  const response = await pending; assert.equal(response.status, 503); assert.equal(calls, 0);
  assert.equal((await response.text()).includes('Dependency deadline'), false);
});

test('worker cancellation stops an unresolved DB wait and never submits admission writes', async () => {
  const parent = new AbortController(); let enter!: () => void, calls = 0;
  const ready = new Promise<void>(resolve => { enter = resolve; });
  const worker = createWorker(), statement = { bind() { return this; } };
  const pending = worker.fetch(new Request('https://collector.example.invalid/v1/projects/sembom/batches', { method: 'POST', signal: parent.signal }),
    { DB: { prepare: () => statement, batch() { calls++; enter(); return new Promise(() => {}); } } });
  await ready; parent.abort(new Error('private cancellation reason'));
  const response = await pending; assert.equal(response.status, 503); assert.equal(calls, 1);
  assert.equal((await response.text()).includes('private'), false);
});
