import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { runCleanup, CLEANUP_ROW_LIMIT } from '../src/cleanup.ts';
import { D1Maintenance } from '@tallyfin/storage-d1';
import { migrationStatements, seed, now } from '../../../packages/storage-d1/test/helpers.ts';

test('failed projects do not block later cleanup or cursor progress', async () => {
  const page = { revision: 0, projects: [{ id: 'bad', timeZone: 'Invalid/Zone' }, { id: 'good', timeZone: 'UTC' }] };
  const seen: string[] = [];
  const report = await runCleanup({
    nextCleanupPage: async limit => { assert.equal(limit, 5); return page; },
    cleanup: async (id, zone, time, limit) => {
      seen.push(id); assert.equal(time, now); assert.equal(limit, CLEANUP_ROW_LIMIT);
      if (zone === 'Invalid/Zone') throw Error('private DB detail');
    },
    advanceCleanupCursor: async value => { assert.equal(value, page); return true; },
  }, now);
  assert.deepEqual(seen, ['bad', 'good']);
  assert.deepEqual(report, { attempted: 2, completed: 1, failed: 1, cursorAdvanced: true });
  assert.ok(!JSON.stringify(report).includes('private DB detail'));
});

test('scan failure never starts cleanup; stale cursor result remains visible', async () => {
  let advanced = false;
  const store = {
    nextCleanupPage: async () => { throw Error('unavailable'); },
    cleanup: async () => { throw Error('must not run'); },
    advanceCleanupCursor: async () => { advanced = true; return false; },
  };
  await assert.rejects(runCleanup(store, now)); assert.equal(advanced, false);
  const report = await runCleanup({ ...store, nextCleanupPage: async () => ({ revision: 0, projects: [] }) }, now);
  assert.equal(report.cursorAdvanced, false);
  await assert.rejects(runCleanup(store, Number.NaN), /invalid cleanup time/);
});

test('real scheduled Worker cleans bounded expired rows and preserves live data', async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-08-06', d1Databases: { DB: 'tallyfin-cleanup-tests' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB');
    const migrations = migrationStatements();
    for (const sql of migrations.filter(sql => !sql.startsWith('CREATE TABLE retention_cleanup_state'))) await db.prepare(sql).run();
    await seed(db);
    await db.prepare("UPDATE projects SET status = 'paused'").run();
    // 501 expired + one unexpired row: one scheduled invocation must leave one expired row.
    await db.prepare(`WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < 501)
      INSERT INTO event_receipts (project_id, source, event_id, schema_version, payload_hash, received_at, expires_at)
      SELECT 'sembom', 'browser', 'expired-' || n, 1, ?, ?, ? FROM nums`).bind('0'.repeat(64), now - 172800000, now).run();
    await db.prepare(`INSERT INTO event_receipts VALUES ('sembom', 'browser', 'live', 1, ?, ?, ?)`)
      .bind('0'.repeat(64), now - 172799999, now + 1).run();
    await db.prepare(`INSERT INTO event_daily_counts VALUES ('sembom', 1, 'browser', '2026-07-11', 'tool_view', '{}', 1, ?),
      ('sembom', 1, 'browser', '2026-07-12', 'tool_view', '{}', 1, ?)`).bind(now, now).run();
    // Upgrade a populated 0001 database without altering its existing rows.
    await db.prepare(migrations.find(sql => sql.startsWith('CREATE TABLE retention_cleanup_state'))!).run();
    assert.equal(await db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 502);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM projects').first('n'), 1);
    const worker = await mf.getWorker();
    assert.equal((await worker.scheduled({ scheduledTime: now, cron: '* * * * *' })).outcome, 'ok');
    assert.equal(await db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 2);
    assert.deepEqual((await db.prepare('SELECT event_date FROM event_daily_counts ORDER BY event_date').all()).results,
      [{ event_date: '2026-07-12' }]);
    assert.equal(await db.prepare('SELECT last_project_id FROM retention_cleanup_state').first('last_project_id'), 'sembom');
    await worker.scheduled({ scheduledTime: now, cron: '* * * * *' });
    assert.equal(await db.prepare('SELECT event_id FROM event_receipts').first('event_id'), 'live');
    assert.equal(await db.prepare('SELECT ingest_revision FROM projects').first('ingest_revision'), 0);
    // A broken project's timezone fails this cron, but progress is still recorded.
    await db.prepare('DROP TRIGGER immutable_project_zone').run();
    await db.prepare("UPDATE projects SET time_zone = 'Invalid/Zone'").run();
    assert.equal((await worker.scheduled({ scheduledTime: now, cron: '* * * * *' })).outcome, 'exception');
    const maintenance = new D1Maintenance(db);
    assert.equal((await maintenance.nextCleanupPage()).revision, 3);
  } finally { await mf.dispose(); }
});
