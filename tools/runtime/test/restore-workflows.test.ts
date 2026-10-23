import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { seedRestoreFixture } from '../restore-fixture.ts';
import { verifyRestoredWorkflows } from '../restore-workflows.ts';

test('restore queries certify measured durations/reasons and reject columns restored as empty historical data', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate: '2026-08-06', d1Databases: { DB: crypto.randomUUID() }, log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB'), fixture = await seedRestoreFixture(db);
    const result = await verifyRestoredWorkflows(db, fixture);
    assert.equal(result.duration.measuredAttempts, 2); assert.equal(result.failureReasons?.measuredFailures, 1);
    const row: any = await db.prepare('SELECT duration_counts_json, failure_reason_counts_json FROM workflow_daily_counts').first();
    await db.prepare('UPDATE workflow_daily_counts SET duration_counts_json=?').bind(JSON.stringify(Array(12).fill(0))).run();
    await assert.rejects(verifyRestoredWorkflows(db, fixture), /restored_workflow_measurements_mismatch/);
    await db.prepare('UPDATE workflow_daily_counts SET duration_counts_json=?,failure_reason_counts_json=?')
      .bind(row.duration_counts_json, JSON.stringify(Array(33).fill(0))).run();
    await assert.rejects(verifyRestoredWorkflows(db, fixture), /restored_workflow_measurements_mismatch/);
  } finally { await mf.dispose(); }
});
