import { CollectionError } from '@tallyfin/core';
import type { AttemptState, PreparedBatch, PreparedServerBatch, Receipt, ServerPrincipal } from '@tallyfin/core';
import type { ProjectRow, SchemaRow, SqlDatabase } from './sql.ts';
import type { FunnelRunRow } from './funnels.ts';

/** One consistent read. Named fields prevent optional publisher/run queries from shifting consumers. */
export async function readIngestSnapshot(db: SqlDatabase, batch: PreparedBatch | PreparedServerBatch, publisher?: ServerPrincipal) {
  const utcDate = new Date(batch.receivedAt).toISOString().slice(0, 10);
  const eventIds = batch.events.map(e => e.event.eventId);
  const attemptIds = [...new Set(batch.events.flatMap(e => e.workflow ? [e.workflow.attemptId] : []))];
  const runIds = [...new Set(batch.events.flatMap(e => e.funnel ? [e.funnel.event.funnel.runId] : []))];
  const placeholders = (ids: string[]) => ids.map(() => '?').join(',') || 'NULL';
  const base = [
    db.prepare('SELECT * FROM projects WHERE id = ?').bind(batch.projectId),
    db.prepare('SELECT * FROM project_schemas WHERE project_id = ? AND version = ?').bind(batch.projectId, batch.schemaVersion),
    db.prepare(`SELECT * FROM event_receipts WHERE project_id = ? AND source = ? AND event_id IN (${placeholders(eventIds)})`).bind(batch.projectId, batch.source, ...eventIds),
    db.prepare(`SELECT * FROM workflow_attempts WHERE project_id = ? AND source = 'browser' AND attempt_id IN (${placeholders(attemptIds)})`).bind(batch.projectId, ...attemptIds),
    db.prepare('SELECT new_receipts FROM ingest_daily_usage WHERE project_id = ? AND utc_date = ?').bind(batch.projectId, utcDate),
  ];
  const extras = [
    ...(publisher ? [db.prepare('SELECT 1 AS authorized FROM project_publishers WHERE project_id = ? AND issuer = ? AND subject = ?')
      .bind(batch.projectId, publisher.issuer, publisher.subject)] : []),
    ...(runIds.length ? [db.prepare(`SELECT * FROM funnel_runs WHERE project_id = ? AND run_id IN (${placeholders(runIds)})`)
      .bind(batch.projectId, ...runIds)] : []),
  ];
  const read = await db.batch<ProjectRow | SchemaRow | Receipt | AttemptState | FunnelRunRow | { new_receipts: number } | { authorized: number }>([...base, ...extras]);
  if (read.length !== base.length + extras.length || read.some(row => !row.success)) throw new CollectionError('storage_unavailable', 503);
  const [project, schema, receipts, attempts, usage, ...extensions] = read;
  const authorization = publisher ? extensions.shift() : undefined;
  const runs = runIds.length ? extensions.shift() : undefined;
  return {
    project: project?.results[0] as ProjectRow | undefined, schema: schema?.results[0] as SchemaRow | undefined,
    publisherAuthorized: !publisher || (authorization?.results.length === 1 && (authorization.results[0] as { authorized?: number })?.authorized === 1),
    receipts: receipts!.results as Receipt[], attempts: attempts!.results as AttemptState[],
    newReceiptsToday: (usage?.results[0] as { new_receipts: number } | undefined)?.new_receipts ?? 0,
    runRows: (runs?.results ?? []) as FunnelRunRow[],
  };
}
