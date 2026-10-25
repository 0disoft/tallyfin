import assert from 'node:assert/strict';
import { test } from 'node:test';
import { D1Store } from '../src/index.ts';
import type { SqlDatabase, SqlStatement, SqlValue } from '../src/sql.ts';
import { batch, prepare, registry, setup } from './helpers.ts';

// Align every contender after its consistent read, before any guarded write.
// Each round has one actual DB winner; no in-process lock implements correctness.
test('four aligned writers reproduce exhaustion of the three-attempt policy', async () => {
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
      return new D1Store(db, { onIngestConflict: entry => conflicts.push(entry) })
        .commit(await prepare(input), registry);
    }));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal(conflicts.filter(e => e.exhausted).length, 1);
    assert.equal(conflicts.length, 6);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 6);
  } finally { await f.mf.dispose(); }
});
