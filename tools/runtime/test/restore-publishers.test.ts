import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { seedRestoreFixture } from '../restore-fixture.ts';
import { verifyRestoredPublishers } from '../restore-publishers.ts';
import { restoreIntegrity } from '../restore-fingerprint.ts';

async function setup() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate: '2026-08-06', d1Databases: { DB: crypto.randomUUID() }, log: new Log(LogLevel.NONE) });
  try { const db = await mf.getD1Database('DB'); return { mf, db, fixture: await seedRestoreFixture(db) }; }
  catch (error) { await mf.dispose(); throw error; }
}
test('publisher recovery exercise verifies real D1 revocation, audit, same-millisecond generations and restored writes', async () => {
  const local = await setup();
  try {
    const result = await verifyRestoredPublishers(local.db, local.fixture);
    assert.deepEqual(result, { revokedWriteRejected: true, revokedWritePreservedData: true, sameMillisecondRegrant: true,
      staleRevokeRejected: true, staleRevokePreservedData: true, noopPreservedData: true,
      regrantedWriteAccepted: true, addedAuditRows: 2 });
    await restoreIntegrity(local.db);
    const report = JSON.stringify(result);
    for (const value of [local.fixture.principal.issuer, local.fixture.principal.subject, local.fixture.funnel.project.id])
      assert.ok(!report.includes(value));
  } finally { await local.mf.dispose(); }
});
test('recovery refuses to certify a database without the restored publisher permission', async () => {
  const local = await setup();
  try {
    await local.db.prepare('DELETE FROM project_publishers').run();
    await assert.rejects(verifyRestoredPublishers(local.db, local.fixture), /publisher_recovery_fixture_missing/);
  } finally { await local.mf.dispose(); }
});
