import { CollectionError, parseServerBatch, prepareServerBatch } from '@tallyfin/core';
import { D1Store } from '@tallyfin/storage-d1';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { PublisherProvisioner } from '../provision/publishers.ts';
import { ProvisionError } from '../provision/input.ts';
import { DRILL_TIME } from './restore-fixture.ts';
import type { seedRestoreFixture } from './restore-fixture.ts';
import { restoreFingerprint } from './restore-fingerprint.ts';

type Fixture = Pick<Awaited<ReturnType<typeof seedRestoreFixture>>, 'funnel' | 'funnelInputs' | 'principal'>;

/** Mutates only the drill's restored synthetic database, after full backup equality was verified. */
export async function verifyRestoredPublishers(db: SqlDatabase, fixture: Fixture) {
  const target = { projectId: fixture.funnel.project.id, ...fixture.principal };
  const permission = async () => {
    const rows = await db.batch<{ grant_id: string; created_at: number }>([
      db.prepare('SELECT grant_id,created_at FROM project_publishers WHERE project_id=? AND issuer=? AND subject=?')
        .bind(target.projectId, target.issuer, target.subject),
    ]);
    if (rows.length !== 1 || !rows[0]?.success || rows[0].results.length > 1) throw Error('publisher_recovery_read_failed');
    return rows[0].results[0];
  };
  const audits = async () => {
    const rows = await db.batch<{ action: string; count: number }>([
      db.prepare(`SELECT action,count(*) AS count FROM admin_changes WHERE project_id=? AND target_issuer=? AND target_subject=?
        AND action IN ('publisher.granted','publisher.revoked') GROUP BY action ORDER BY action`)
        .bind(target.projectId, target.issuer, target.subject),
    ]);
    if (rows.length !== 1 || !rows[0]?.success) throw Error('publisher_recovery_read_failed');
    return { granted: rows[0].results.find(row => row.action === 'publisher.granted')?.count ?? 0,
      revoked: rows[0].results.find(row => row.action === 'publisher.revoked')?.count ?? 0 };
  };
  const original = await permission(), beforeAudit = await audits();
  if (!original || beforeAudit.granted < 1) throw Error('publisher_recovery_fixture_missing');
  const publisher = new PublisherProvisioner(db), store = new D1Store(db);
  const stale = await publisher.plan('publisher-revoke', target);
  await publisher.apply(await publisher.plan('publisher-revoke', target), DRILL_TIME);
  if (await permission()) throw Error('restored_publisher_revoke_failed');
  const revokedAudit = await audits();
  if (revokedAudit.granted !== beforeAudit.granted || revokedAudit.revoked !== beforeAudit.revoked + 1)
    throw Error('restored_publisher_revoke_audit_failed');

  const last = fixture.funnelInputs[3]!;
  // A new receipt, rather than replaying an already accepted event, proves revoked writes are refused.
  const { funnel: _connection, ...event } = last.events[0]!;
  const fresh = await prepareServerBatch(parseServerBatch(JSON.stringify({ schemaVersion: 1, source: 'server',
    events: [{ ...event, eventId: crypto.randomUUID() }] })), fixture.funnel, DRILL_TIME);
  const revoked = await restoreFingerprint(db);
  let denied = false;
  try { await store.commitServer(fresh, fixture.funnel, fixture.principal); }
  catch (error) { if (error instanceof CollectionError && error.code === 'forbidden') denied = true; else throw error; }
  if (!denied || (await restoreFingerprint(db)).fingerprint !== revoked.fingerprint)
    throw Error('revoked_publisher_changed_restored_data');

  await publisher.apply(await publisher.plan('publisher-grant', target), DRILL_TIME);
  const renewed = await permission(), renewedAudit = await audits();
  if (!renewed || renewed.grant_id === original.grant_id || renewed.created_at !== original.created_at ||
    renewedAudit.granted !== beforeAudit.granted + 1 || renewedAudit.revoked !== beforeAudit.revoked + 1)
    throw Error('restored_publisher_generation_or_audit_failed');
  const regranted = await restoreFingerprint(db);
  let conflict = false;
  try { await publisher.apply(stale, DRILL_TIME); }
  catch (error) { if (error instanceof ProvisionError && error.code === 'apply_conflict') conflict = true; else throw error; }
  if (!conflict || (await restoreFingerprint(db)).fingerprint !== regranted.fingerprint)
    throw Error('stale_revoke_changed_restored_data');
  const noop = await publisher.apply(await publisher.plan('publisher-grant', target), DRILL_TIME);
  if (noop.applied || noop.changes !== 0 || (await restoreFingerprint(db)).fingerprint !== regranted.fingerprint)
    throw Error('publisher_noop_changed_restored_data');
  await store.publisherAccess(target.projectId, fixture.principal);
  const admitted = await store.commitServer(fresh, fixture.funnel, fixture.principal);
  if (admitted.accepted !== 1 || admitted.duplicates !== 0 || JSON.stringify(await audits()) !== JSON.stringify(renewedAudit))
    throw Error('regranted_publisher_write_failed');
  return { revokedWriteRejected: true, revokedWritePreservedData: true, sameMillisecondRegrant: true,
    staleRevokeRejected: true, staleRevokePreservedData: true, noopPreservedData: true,
    regrantedWriteAccepted: true, addedAuditRows: 2 };
}
