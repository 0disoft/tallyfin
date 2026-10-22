import { CollectionError, DAY, RETENTION_POLICY, ADMIN_CHANGE_RETENTION_DAYS, localDate } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';
import { D1_POLICY } from './policy.ts';

export interface CleanupMetrics { deletedRows: number; saturatedTables: number; oldestExpiredReceiptAgeMs: number | null }
/** Nine bounded deletes; optional tenth statement observes the remaining receipt backlog. */
export async function cleanupRows(db: SqlDatabase, projectId: string, timeZone: string, now: number, limit: number, measure: boolean): Promise<CleanupMetrics> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > D1_POLICY.maxCleanupRows) throw Error('invalid cleanup limit');
  const today = localDate(now, timeZone);
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - (RETENTION_POLICY.analyticsDays - 1) * DAY).toISOString().slice(0, 10);
  const statements = ['event_receipts', 'workflow_attempts', 'funnel_runs', 'ingest_daily_usage'].map(table => db.prepare(
    `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id = ? AND expires_at <= ? LIMIT ?)`
  ).bind(projectId, now, limit));
  statements.push(db.prepare(`DELETE FROM ingest_minute_usage WHERE rowid IN (SELECT rowid FROM ingest_minute_usage WHERE project_id = ?
    AND (minute_start < ? OR (rejections_json = '{}' AND minute_start < ?)) LIMIT ?)`).bind(projectId,
      Math.floor(now / DAY) * DAY - (RETENTION_POLICY.rejectionDays - 1) * DAY, Math.floor(now / 60_000) * 60_000 - RETENTION_POLICY.idleMinuteGraceMs, limit));
  for (const [table, column] of [['event_daily_counts', 'event_date'], ['workflow_daily_counts', 'cohort_date'], ['funnel_daily_counts', 'cohort_date']])
    statements.push(db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id = ? AND ${column} < ? LIMIT ?)`).bind(projectId, oldest, limit));
  statements.push(db.prepare(`DELETE FROM admin_changes WHERE id IN
    (SELECT id FROM admin_changes WHERE project_id = ? AND occurred_at < ? ORDER BY occurred_at, id LIMIT ?)`)
    .bind(projectId, now - ADMIN_CHANGE_RETENTION_DAYS * DAY, limit));
  const deleteCount = statements.length;
  if (measure) statements.push(db.prepare('SELECT MIN(expires_at) AS oldest FROM event_receipts WHERE project_id = ? AND expires_at <= ?').bind(projectId, now));
  const results = await db.batch<{ oldest: number | null }>(statements);
  if (results.length !== statements.length || results.some(row => !row.success)) throw new CollectionError('storage_unavailable', 503);
  let deletedRows = 0, saturatedTables = 0;
  for (const row of results.slice(0, deleteCount)) {
    if (!Number.isSafeInteger(row.meta.changes) || row.meta.changes < 0 || row.meta.changes > limit) throw new CollectionError('storage_unavailable', 503);
    deletedRows += row.meta.changes;
    if (row.meta.changes === limit) saturatedTables++;
  }
  const oldestExpiry = measure ? results[deleteCount]?.results[0]?.oldest : null;
  if (oldestExpiry !== null && (!Number.isSafeInteger(oldestExpiry) || oldestExpiry === undefined || oldestExpiry < 0 || oldestExpiry > now))
    throw new CollectionError('storage_unavailable', 503);
  return { deletedRows, saturatedTables, oldestExpiredReceiptAgeMs: oldestExpiry === null ? null : now - oldestExpiry! };
}
