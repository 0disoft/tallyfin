import assert from 'node:assert/strict';
import { test } from 'node:test';
import { D1Store } from '../src/index.ts';
import type { SqlDatabase, SqlStatement } from '../src/sql.ts';
import { batch, prepare, registry, setup } from './helpers.ts';

// Only align initial reads. DB transactions, never this test barrier, enforce correctness.
function alignedStores(db: SqlDatabase, count: number) {
  let arrived = 0, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const stats = { snapshots: 0, writes: 0, conflicts: 0 };
  const stores = Array.from({ length: count }, () => {
    let first = true, reading = true;
    return new D1Store({ prepare: query => db.prepare(query), async batch<T>(statements: SqlStatement[]) {
      const initial = first; first = false;
      if (reading) stats.snapshots++; else stats.writes++;
      reading = !reading;
      const result = await db.batch<T>(statements);
      if (initial) { if (++arrived === count) release(); await ready; }
      return result;
    } }, { random: () => 0, onIngestConflict: () => { stats.conflicts++; } });
  });
  return { stores, stats };
}
function independentBatch() {
  const input = batch(), attemptId = crypto.randomUUID();
  for (const event of input.events) {
    event.eventId = crypto.randomUUID();
    if (event.attempt) event.attempt.attemptId = attemptId;
  }
  return input;
}

for (const count of [4, 16]) test(`${count} independent aligned writers commit without stale-revision retries`, async () => {
  const f = await setup();
  try {
    const { stores, stats } = alignedStores(f.db, count);
    const inputs = await Promise.all(stores.map(() => prepare(independentBatch())));
    const results = await Promise.all(stores.map((store, index) => store.commit(inputs[index]!, registry)));
    assert.ok(results.every(result => result.accepted === 2 && result.duplicates === 0));
    assert.deepEqual(stats, { snapshots: count, writes: count, conflicts: 0 });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), count * 2);
    assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), count * 2);
    assert.equal(await f.db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), count * 2);
  } finally { await f.mf.dispose(); }
});

test('aligned identical receipts count once and retries observe the winner', async () => {
  const f = await setup();
  try {
    const { stores, stats } = alignedStores(f.db, 4), input = await prepare();
    const results = await Promise.all(stores.map(store => store.commit(input, registry)));
    assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 2);
    assert.equal(results.reduce((sum, result) => sum + result.duplicates, 0), 6);
    assert.equal(stats.conflicts, 3);
    assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 2);
    assert.equal(await f.db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), 2);
  } finally { await f.mf.dispose(); }
});

test('different event IDs racing on an existing attempt do not count its terminal twice', async () => {
  const f = await setup();
  try {
    const original = batch();
    await f.store.commit(await prepare({ ...original, events: [original.events[0]] }), registry);
    const { stores, stats } = alignedStores(f.db, 4);
    const inputs = await Promise.all(stores.map(() => prepare({ ...original,
      events: [{ ...original.events[1], eventId: crypto.randomUUID() }] })));
    const results = await Promise.all(stores.map((store, index) => store.commit(inputs[index]!, registry)));
    assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 1);
    assert.equal(results.reduce((sum, result) => sum + result.duplicates, 0), 3);
    assert.ok(stats.conflicts >= 3);
    const row = await f.db.prepare('SELECT * FROM workflow_daily_counts').first();
    assert.equal(row!.started_count, 1); assert.equal(row!.succeeded_count, 1);
    assert.equal(await f.db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), 5);
    assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 2);
  } finally { await f.mf.dispose(); }
});

test('live daily quota rejects a whole racing batch even when both snapshots had capacity', async () => {
  const f = await setup();
  try {
    await f.db.prepare('UPDATE projects SET new_receipts_per_utc_day=3').run();
    const limited = (await f.store.loadRegistry(registry.project.id, 1))!;
    const { stores, stats } = alignedStores(f.db, 2);
    const inputs = await Promise.all(stores.map(() => prepare(independentBatch(), undefined, limited)));
    const results = await Promise.allSettled(stores.map((store, index) => store.commit(inputs[index]!, limited)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected?.status === 'rejected' && rejected.reason.code, 'quota_exceeded');
    assert.equal(stats.conflicts, 1);
    assert.equal(await f.db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), 2);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 2);
    assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 2);
  } finally { await f.mf.dispose(); }
});

test('retry exhaustion is bounded, preserves its cause and never replays other DB failures', async () => {
  const f = await setup();
  try {
    const prepared = await prepare();
    for (const named of [true, false]) {
      const cause = new Error(named ? 'CHECK constraint failed: tallyfin_ingest_revision' : 'unrelated transport error');
      let reads = 0, writes = 0, exhausted = 0;
      const db: SqlDatabase = { prepare: q => f.db.prepare(q), async batch<T>(s: SqlStatement[]) {
        if (s.length === 5) { reads++; return f.db.batch<T>(s as Parameters<typeof f.db.batch>[0]); }
        writes++; throw cause;
      } };
      const store = new D1Store(db, { random: () => 0, onIngestConflict: entry => {
        if (entry.exhausted) exhausted++;
        throw Error('diagnostic sink unavailable');
      } });
      await assert.rejects(store.commit(prepared, registry), e =>
        e instanceof Error && 'code' in e && e.code === 'storage_unavailable' && e.cause === cause);
      assert.equal(reads, named ? 8 : 1); assert.equal(writes, reads);
      assert.equal(exhausted, named ? 1 : 0);
    }
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 0);
  } finally { await f.mf.dispose(); }
});

test('cancellation during backoff prevents another snapshot or write and retains the reason', async () => {
  const f = await setup();
  try {
    const controller = new AbortController(), reason = Error('request deadline reached');
    let reads = 0, writes = 0;
    const db: SqlDatabase = { prepare: q => f.db.prepare(q), async batch<T>(s: SqlStatement[]) {
      if (s.length === 5) { reads++; return f.db.batch<T>(s as Parameters<typeof f.db.batch>[0]); }
      writes++; throw Error('CHECK constraint failed: tallyfin_ingest_revision');
    } };
    const store = new D1Store(db, { signal: controller.signal, random: () => {
      queueMicrotask(() => controller.abort(reason)); return 0.99;
    } });
    await assert.rejects(store.commit(await prepare(), registry), e => e === reason);
    assert.equal(reads, 1); assert.equal(writes, 1);
    await assert.rejects(store.commit(await prepare(), registry), e => e === reason);
    assert.equal(reads, 1);
  } finally { await f.mf.dispose(); }
});
