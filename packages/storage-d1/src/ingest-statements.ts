import { DAY, emptyDurationCounts, RETENTION_POLICY, WORKFLOW_DURATION_SLOTS } from '@tallyfin/core';
import { emptyFailureReasonCounts, FAILURE_REASON_SLOTS } from '@tallyfin/core';
import type { IngestPlan, PreparedBatch, PreparedServerBatch, ServerPrincipal } from '@tallyfin/core';
import { bulk } from './sql.ts';
import type { ProjectRow, SchemaRow, SqlDatabase, SqlStatement } from './sql.ts';
import { funnelStatements } from './funnels.ts';
import { ingestStateGuard } from './ingest-state-guard.ts';
import type { readIngestSnapshot } from './ingest-snapshot.ts';

/** Statement construction only; the caller executes the entire guarded batch atomically. */
export function ingestStatements(db: SqlDatabase, batch: PreparedBatch | PreparedServerBatch, project: ProjectRow,
  schema: SchemaRow, plan: IngestPlan, snapshot: Awaited<ReturnType<typeof readIngestSnapshot>>, publisher?: ServerPrincipal): SqlStatement[] {
  const utcDate = new Date(batch.receivedAt).toISOString().slice(0, 10);
  const guard = ingestStateGuard(batch, snapshot, plan.receipts.length);
  const statements: SqlStatement[] = [db.prepare(`UPDATE projects SET
    ingest_revision = CASE WHEN status = 'active' AND time_zone = ?
      AND allowed_origins_json = ? AND new_receipts_per_utc_day = ? AND requests_per_minute = ?
      AND EXISTS (SELECT 1 FROM project_schemas WHERE project_id = ? AND version = ? AND status = 'active' AND definitions_json = ?)
      ${publisher ? 'AND EXISTS (SELECT 1 FROM project_publishers WHERE project_id = ? AND issuer = ? AND subject = ?)' : ''}
      AND ${guard.sql}
      THEN ingest_revision + 1 ELSE -1 END,
    latest_received_at = max(coalesce(latest_received_at, 0), ?) WHERE id = ?`).bind(project.time_zone,
      project.allowed_origins_json, project.new_receipts_per_utc_day, project.requests_per_minute,
      batch.projectId, batch.schemaVersion, schema.definitions_json,
      ...(publisher ? [batch.projectId, publisher.issuer, publisher.subject] : []), ...guard.bindings, batch.receivedAt, batch.projectId)];
  statements.push(...bulk(db, 'event_receipts', ['project_id', 'source', 'event_id', 'schema_version', 'payload_hash', 'received_at', 'expires_at'],
    plan.receipts.map(r => [batch.projectId, batch.source, r.event_id, r.schema_version, r.payload_hash, r.received_at, r.expires_at]),
    `ON CONFLICT(project_id, source, event_id) DO UPDATE SET schema_version=excluded.schema_version, payload_hash=excluded.payload_hash, received_at=excluded.received_at, expires_at=excluded.expires_at`));
  statements.push(...bulk(db, 'workflow_attempts', ['project_id', 'source', 'attempt_id', 'schema_version', 'workflow_id', 'started_at', 'cohort_date', 'dimension_key', 'start_seen', 'terminal_kind', 'terminal_at', 'expires_at', 'failure_reason_slot'],
    plan.attempts.map(a => [batch.projectId, 'browser', a.attempt_id, a.schema_version, a.workflow_id, a.started_at, a.cohort_date, a.dimension_key, a.start_seen, a.terminal_kind, a.terminal_at, a.expires_at, a.failure_reason_slot ?? null]),
    `ON CONFLICT(project_id, source, attempt_id) DO UPDATE SET schema_version=excluded.schema_version, workflow_id=excluded.workflow_id, started_at=excluded.started_at, cohort_date=excluded.cohort_date, dimension_key=excluded.dimension_key, start_seen=excluded.start_seen, terminal_kind=excluded.terminal_kind, terminal_at=excluded.terminal_at, expires_at=excluded.expires_at, failure_reason_slot=excluded.failure_reason_slot`));
  statements.push(db.prepare(`INSERT INTO ingest_daily_usage (project_id, utc_date, new_receipts, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, utc_date) DO UPDATE SET new_receipts = new_receipts + excluded.new_receipts`).bind(
      batch.projectId, utcDate, plan.receipts.length, Date.parse(`${utcDate}T00:00:00Z`) + RETENTION_POLICY.dailyUsageDays * DAY));
  statements.push(...bulk(db, 'event_daily_counts', ['project_id', 'schema_version', 'source', 'event_date', 'event_name', 'dimension_key', 'count', 'updated_at'],
    plan.events.map(e => [batch.projectId, batch.schemaVersion, batch.source, e.event_date, e.event_name, e.dimension_key, e.count, batch.receivedAt]),
    `ON CONFLICT(project_id, schema_version, source, event_date, event_name, dimension_key) DO UPDATE SET count=count+excluded.count, updated_at=max(updated_at, excluded.updated_at)`));
  statements.push(...bulk(db, 'workflow_daily_counts', ['project_id', 'schema_version', 'source', 'cohort_date', 'workflow_id', 'dimension_key', 'started_count', 'succeeded_count', 'failed_count', 'updated_at'],
    plan.workflows.map(w => [batch.projectId, batch.schemaVersion, 'browser', w.cohort_date, w.workflow_id, w.dimension_key, 0, 0, 0, batch.receivedAt]),
    `ON CONFLICT(project_id, schema_version, source, cohort_date, workflow_id, dimension_key) DO NOTHING`));
  // SQLite validates the INSERT before resolving its conflict. A terminal-only delta
  // (0 starts, 1 success) is invalid as a new row, but valid when added to an existing cohort.
  // Create valid zero rows, then apply deltas within the same guarded atomic write batch.
  statements.push(...plan.workflows.map(w => db.prepare(`UPDATE workflow_daily_counts SET
    started_count=started_count+?, succeeded_count=succeeded_count+?, failed_count=failed_count+?,
    duration_counts_json=json_array(${Array.from({ length: WORKFLOW_DURATION_SLOTS }, (_, index) =>
      `CAST(json_extract(duration_counts_json, '$[${index}]') + ? AS INTEGER)`).join(',')}),
    failure_reason_counts_json=json_array(${Array.from({ length: FAILURE_REASON_SLOTS }, (_, index) =>
      `CAST(json_extract(failure_reason_counts_json, '$[${index}]') + ? AS INTEGER)`).join(',')}),
    updated_at=max(updated_at, ?) WHERE project_id=? AND schema_version=? AND source='browser'
    AND cohort_date=? AND workflow_id=? AND dimension_key=?`).bind(w.started_count, w.succeeded_count,
      w.failed_count, ...(w.durationCounts ?? emptyDurationCounts()), ...(w.failureReasonCounts ?? emptyFailureReasonCounts()),
      batch.receivedAt, batch.projectId, batch.schemaVersion, w.cohort_date, w.workflow_id, w.dimension_key)));
  statements.push(...funnelStatements(db, batch.projectId, batch.schemaVersion, batch.receivedAt, plan));
  return statements;
}
