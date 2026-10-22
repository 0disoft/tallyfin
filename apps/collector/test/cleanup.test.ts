import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { runCleanup, CLEANUP_ROW_LIMIT, CLEANUP_BUDGET_MS, CLEANUP_RUN_PROJECT_LIMIT, CLEANUP_PROJECT_LIMIT } from '../src/cleanup.ts';
import { D1Maintenance } from '@tallyfin/storage-d1';
import { createWorker } from '../src/index.ts';
import { migrationStatements, seed, now } from '../../../packages/storage-d1/test/helpers.ts';

test('failed projects do not block later cleanup or cursor progress', async () => {
  const page = { revision: 0, projects: [{ id: 'bad', timeZone: 'Invalid/Zone' }, { id: 'good', timeZone: 'UTC' }] };
  const seen: string[] = [];
  const report = await runCleanup({
    nextCleanupPage: async limit => { assert.equal(limit, CLEANUP_PROJECT_LIMIT); return page; },
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

function paged(count: number) {
  const projects = Array.from({ length: count }, (_, index) => ({ id: `project-${String(index).padStart(2, '0')}`, timeZone: 'UTC' }));
  let cursor = 0, revision = 0, reads = 0;
  const seen: string[] = [], checkpoints: string[][] = [];
  return { seen, checkpoints, reads: () => reads, store: {
    async nextCleanupPage(limit: number) {
      reads++; return { revision, projects: projects.slice(cursor, cursor + limit) };
    },
    async cleanup(id: string) { seen.push(id); },
    async advanceCleanupCursor(page: { revision: number; projects: { id: string }[] }) {
      assert.equal(page.revision, revision++); checkpoints.push(page.projects.map(project => project.id));
      cursor = (cursor + page.projects.length) % projects.length; return true;
    },
  } };
}

test('cleanup processes at most four sequential pages and never repeats projects after wrapping', async () => {
  for (const count of [7, CLEANUP_RUN_PROJECT_LIMIT, CLEANUP_RUN_PROJECT_LIMIT + 1]) {
    const f = paged(count), report = await runCleanup(f.store, now, { clock: () => 0, maxPages: 4 });
    assert.equal(report.attempted, Math.min(count, CLEANUP_RUN_PROJECT_LIMIT));
    assert.equal(report.completed, report.attempted); assert.equal(report.cursorAdvanced, true);
    assert.equal(new Set(f.seen).size, report.attempted);
    assert.equal(f.checkpoints.flat().length, report.attempted); assert.ok(f.reads() <= 4);
  }
});

test('budget boundaries persist only the attempted prefix and leave the next project for a later run', async () => {
  for (const elapsed of [CLEANUP_BUDGET_MS - 1, CLEANUP_BUDGET_MS, CLEANUP_BUDGET_MS + 1]) {
    const f = paged(7); let time = 0;
    const report = await runCleanup({ ...f.store,
      async nextCleanupPage(limit) { time = elapsed; return f.store.nextCleanupPage(limit); },
      async cleanup(id) { await f.store.cleanup(id); time++; },
    }, now, { clock: () => time });
    const expected = elapsed < CLEANUP_BUDGET_MS ? 1 : 0;
    assert.equal(report.attempted, expected); assert.equal(report.cursorAdvanced, expected === 1);
    assert.deepEqual(f.checkpoints.flat(), f.seen); assert.equal(f.reads(), 1);
    if (expected) {
      const next = await runCleanup(f.store, now, { clock: () => 0, maxPages: 4 });
      assert.equal(next.attempted, 7); assert.equal(f.seen[1], 'project-01');
    }
  }
});

test('cursor conflict stops before the next page; cancellation preserves its cause without advancing', async () => {
  const f = paged(7), report = await runCleanup({ ...f.store, advanceCleanupCursor: async () => false }, now, { maxPages: 4 });
  assert.equal(report.attempted, CLEANUP_PROJECT_LIMIT); assert.equal(report.cursorAdvanced, false); assert.equal(f.reads(), 1);
  const aborted = paged(7), controller = new AbortController(), reason = new Error('scheduled lifetime ended');
  const store = { ...aborted.store, async cleanup() { controller.abort(reason); throw reason; } };
  await assert.rejects(runCleanup(store, now, { signal: controller.signal }), error => error === reason);
  assert.equal(aborted.reads(), 1); assert.equal(aborted.checkpoints.length, 0);
  await assert.rejects(runCleanup(store, now, { signal: controller.signal }), error => error === reason);
  assert.equal(aborted.reads(), 1);
});

test('default query budget is one page; elapsed budget and invalid options never start another page', async () => {
  const f = paged(21), report = await runCleanup(f.store, now, { clock: () => 0 });
  assert.equal(report.attempted, CLEANUP_PROJECT_LIMIT); assert.equal(f.reads(), 1);
  let time = 0; const timed = paged(21);
  const timedReport = await runCleanup({ ...timed.store, async cleanup(id) {
    await timed.store.cleanup(id); if (timed.seen.length === CLEANUP_PROJECT_LIMIT) time = CLEANUP_BUDGET_MS;
  } }, now, { clock: () => time, maxPages: 4 });
  assert.equal(timedReport.attempted, CLEANUP_PROJECT_LIMIT); assert.equal(timedReport.cursorAdvanced, true); assert.equal(timed.reads(), 1);
  for (const maxPages of [0, 5, 1.5, NaN]) {
    await assert.rejects(runCleanup(f.store, now, { maxPages }), TypeError);
    assert.throws(() => createWorker(undefined, undefined, { cleanupMaxPages: maxPages }), TypeError);
  }
  assert.equal(f.reads(), 1);
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
    const maintenanceMetrics = new D1Maintenance(db);
    await db.prepare(`WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < 1201)
      INSERT INTO event_receipts SELECT 'sembom', 'browser', 'backlog-' || n, 1, ?, ?, ? FROM nums`)
      .bind('0'.repeat(64), now - 172800000 - 1234, now - 1234).run();
    const metrics = await maintenanceMetrics.cleanupReport('sembom', 'Asia/Seoul', now, 500);
    assert.deepEqual(metrics, { deletedRows: 500, saturatedTables: 1, oldestExpiredReceiptAgeMs: 1234 });
    const drained = await maintenanceMetrics.cleanupReport('sembom', 'Asia/Seoul', now, 1000);
    assert.deepEqual(drained, { deletedRows: 701, saturatedTables: 0, oldestExpiredReceiptAgeMs: null });
    assert.equal(await db.prepare('SELECT event_id FROM event_receipts').first('event_id'), 'live');
    // A broken project's timezone fails this cron, but progress is still recorded.
    await db.prepare('DROP TRIGGER immutable_project_zone').run();
    await db.prepare("UPDATE projects SET time_zone = 'Invalid/Zone'").run();
    assert.equal((await worker.scheduled({ scheduledTime: now, cron: '* * * * *' })).outcome, 'exception');
    const maintenance = new D1Maintenance(db);
    assert.equal((await maintenance.nextCleanupPage()).revision, 3);
    await db.prepare("UPDATE projects SET time_zone = 'Asia/Seoul'").run();
    for (let index = 0; index < 6; index++) {
      const id = `aaa-${index}`; await seed(db, id);
      await db.prepare("INSERT INTO event_receipts VALUES (?, 'browser', 'expired', 1, ?, ?, ?)")
        .bind(id, '0'.repeat(64), now - 172800000, now).run();
    }
    assert.equal((await worker.scheduled({ scheduledTime: now, cron: '* * * * *' })).outcome, 'ok');
    assert.equal(await db.prepare("SELECT count(*) FROM event_receipts WHERE event_id='expired'").first('count(*)'), 2);
    assert.equal((await maintenance.nextCleanupPage()).revision, 4);
    let defaultQueries = 0;
    await createWorker().scheduled({ scheduledTime: now }, { DB: {
      prepare: sql => db.prepare(sql),
      async batch(statements) { defaultQueries += statements.length; return db.batch(statements as Parameters<typeof db.batch>[0]); },
    } });
    assert.ok(defaultQueries <= 50);
    let queries = 0;
    await createWorker(undefined, undefined, { cleanupMaxPages: 4 }).scheduled({ scheduledTime: now }, { DB: {
      prepare: sql => db.prepare(sql),
      async batch(statements) { queries += statements.length; return db.batch(statements as Parameters<typeof db.batch>[0]); },
    } });
    assert.equal(await db.prepare("SELECT count(*) FROM event_receipts WHERE event_id='expired'").first('count(*)'), 0);
    assert.equal((await maintenance.nextCleanupPage()).revision, 7); assert.ok(queries <= 200);
  } finally { await mf.dispose(); }
});


test('cleanup scales bounded row budgets with project count and reports insufficient capacity', async () => {
  for (const [projectCount, dailyLimit, expected, capped] of [[100, 100000, 3473, 0], [200, 100000, 6945, 0], [200, 1000000, 10000, 1]]) {
    let used;
    const report = await runCleanup({
      nextCleanupPage: async () => ({ revision: 0, projectCount, projects: [{ id: 'sample', timeZone: 'UTC', dailyLimit }] }),
      cleanup: async () => { throw Error('legacy cleanup must not run'); },
      cleanupReport: async (_id, _zone, _now, limit) => { used = limit; return { deletedRows: limit, saturatedTables: 1, oldestExpiredReceiptAgeMs: 123 }; },
      advanceCleanupCursor: async () => true,
    }, now);
    assert.equal(used, expected);
    assert.deepEqual(report.metrics, { deletedRows: expected, saturatedTables: 1, oldestExpiredReceiptAgeMs: 123, measuredProjects: 1, capacityLimitedProjects: capped });
  }
});
