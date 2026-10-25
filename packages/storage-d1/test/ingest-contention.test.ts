import assert from 'node:assert/strict';
import { test } from 'node:test';
import { D1Store } from '../src/index.ts';
import type { SqlDatabase, SqlStatement, SqlValue } from '../src/sql.ts';
import { batch, prepare, registry, setup } from './helpers.ts';

// Align every contender after its consistent read, before any guarded write.
// Each round has one actual DB winner; no in-process lock implements correctness.
test('four aligned writers survive three stale snapshots without partial or duplicate aggregates', async () => {
  const f = await setup();
  try {
    const rounds = new Map<number, { arrived: number; ready: Promise<void>; release: () => void }>();
    const align = async (round: number) => {
      let group = rounds.get(round);
      if (!group) {
        let release!: () => void;
        group = { arrived: 0, ready: new Promise<void>(r => { release = r; }), release };
        rounds.set(round, group);
      }
      if (++group.arrived === 4 - round) group.release();
      await group.ready;
    };
    const conflicts: { attempt: number; exhausted: boolean }[] = [];
    const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
      let round = 0;
      const native = new WeakMap<SqlStatement, ReturnType<typeof f.db.prepare>>();
      const wrap = (sql: string, values: SqlValue[] = []): SqlStatement => {
        const port = { bind: (...p: SqlValue[]) => wrap(sql, p) };
        native.set(port, f.db.prepare(sql).bind(...values)); return port;
      };
      const db: SqlDatabase = { prepare: wrap, async batch<T>(statements: SqlStatement[]) {
        const result = await f.db.batch<T>(statements.map(s => native.get(s)!));
        // The only multi-query successful batch before writes is the snapshot.
        if (statements.length === 5) await align(round++);
        return result;
      } };
      const input = batch(), attemptId = crypto.randomUUID();
      for (const event of input.events) {
        event.eventId = crypto.randomUUID();
        if (event.attempt) event.attempt.attemptId = attemptId;
      }
      return new D1Store(db, { random: () => 0, onIngestConflict: entry => conflicts.push(entry) })
        .commit(await prepare(input), registry);
    }));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 4);
    assert.equal(results.filter(r => r.status === 'rejected').length, 0);
    assert.equal(conflicts.filter(e => e.exhausted).length, 0);
    assert.equal(conflicts.length, 6);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 8);
    assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 8);
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
