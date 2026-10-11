import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pace } from '../retained-bench.ts';
import { seedRetainedFixture, RETAINED_PROJECTS } from '../retained-fixture.ts';
import { setup } from '../../../packages/storage-d1/test/helpers.ts';
import { runCleanup } from '../../../apps/collector/src/cleanup.ts';
import { D1Maintenance } from '@tallyfin/storage-d1';

test('paced workload fails on overload instead of reducing offered rate and drains every started job', async () => {
  let active = 0, drained = false, started = 0;
  await assert.rejects(pace([0, 1, 2].map(value => ({ offsetMs: 0, value })), 0, 1, async value => {
    started++; active++; await delay(10); active--; drained = true; return value;
  }, new AbortController().signal), /paced-concurrency-limit/);
  assert.equal(started, 1); assert.equal(active, 0); assert.equal(drained, true);
  const result = await pace([{ offsetMs: 0, value: 0 }, { offsetMs: 0, value: 1 }], 0, 2,
    async value => { await delay(value ? 1 : 10); return value; }, new AbortController().signal);
  assert.deepEqual(result, [0, 1]);
  await assert.rejects(pace([{ offsetMs: 0, value: 0 }], 0, 1, async () => { throw Error('request-failed'); }, new AbortController().signal), /request-failed/);
  let called = false; const controller = new AbortController(); controller.abort();
  await assert.rejects(pace([{ offsetMs: 0, value: 0 }], 0, 1, async () => { called = true; }, controller.signal));
  assert.equal(called, false);
  await assert.rejects(pace([{ offsetMs: 2, value: 0 }, { offsetMs: 1, value: 1 }], 2, 1, async value => value, new AbortController().signal));
});

test('synthetic retained history uses valid dimensions and cleanup visits all six projects while preserving in-range data', async () => {
  const f = await setup(), now = Date.parse('2026-10-11T03:00:00Z');
  const principal = { issuer: 'https://identity.example.invalid', subject: 'synthetic-benchmark-operator' };
  try {
    // Existing setup project is retained too; seeded projects must not starve behind it.
    const fixture = await seedRetainedFixture(f.db, principal, now, { receipts: 3, attempts: 2, expired: 4, days: 3 });
    const maintenance = new D1Maintenance(f.db);
    for (let index = 0; index < 4; index++) { const outcome = await runCleanup(maintenance, now); assert.equal(outcome.failed, 0); assert.equal(outcome.cursorAdvanced, true); }
    for (const project of RETAINED_PROJECTS) {
      assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM event_receipts WHERE project_id=?').bind(project).first('n'), 3);
      assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM workflow_attempts WHERE project_id=?').bind(project).first('n'), 2);
      assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM event_daily_counts WHERE project_id=? AND event_date<?').bind(project, fixture.oldest).first('n'), 0);
      assert.equal(await f.db.prepare('SELECT SUM(count) AS n FROM event_daily_counts WHERE project_id=?').bind(project).first('n'), 3 * 18 * 100);
    }
  } finally { await f.mf.dispose(); }
});
