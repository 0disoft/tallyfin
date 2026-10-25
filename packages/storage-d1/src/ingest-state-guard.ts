import type { PreparedBatch, PreparedServerBatch } from '@tallyfin/core';
import type { readIngestSnapshot } from './ingest-snapshot.ts';
import type { SqlValue } from './sql.ts';

type StoredSnapshot = Awaited<ReturnType<typeof readIngestSnapshot>>;

/** Check only state used by this plan, inside the same transaction as every write. */
export function ingestStateGuard(batch: PreparedBatch | PreparedServerBatch, snapshot: StoredSnapshot, newReceipts: number) {
  const conditions: string[] = [], bindings: SqlValue[] = [];
  const unchanged = (table: string, key: string, columns: readonly string[], ids: string[], rows: [string, object][], source?: string) => {
    if (!ids.length) return;
    const previous = new Map(rows);
    const expected = [...new Set(ids)].map(id => ({ key: id, row: previous.get(id) ?? null }));
    conditions.push(`NOT EXISTS (SELECT 1 FROM json_each(?) AS expected
      LEFT JOIN ${table} AS actual ON actual.project_id = ? ${source ? 'AND actual.source = ?' : ''}
      AND actual.${key} = json_extract(expected.value, '$.key')
      WHERE ${columns.map(column => `actual.${column} IS NOT json_extract(expected.value, '$.row.${column}')`).join(' OR ')})`);
    bindings.push(JSON.stringify(expected), batch.projectId, ...(source ? [source] : []));
  };
  unchanged('event_receipts', 'event_id', ['event_id', 'schema_version', 'payload_hash', 'received_at', 'expires_at'],
    batch.events.map(event => event.event.eventId), snapshot.receipts.map(row => [row.event_id, row]), batch.source);
  unchanged('workflow_attempts', 'attempt_id', ['attempt_id', 'schema_version', 'workflow_id', 'started_at', 'cohort_date',
    'dimension_key', 'start_seen', 'terminal_kind', 'terminal_at', 'expires_at', 'failure_reason_slot'],
    batch.events.flatMap(event => event.workflow ? [event.workflow.attemptId] : []),
    snapshot.attempts.map(row => [row.attempt_id, row]), 'browser');
  unchanged('funnel_runs', 'run_id', ['run_id', 'schema_version', 'funnel_id', 'started_at', 'cohort_date',
    'dimension_key', 'step_times_json', 'expires_at'],
    batch.events.flatMap(event => event.funnel ? [event.funnel.event.funnel.runId] : []),
    snapshot.runRows.map(row => [row.run_id, row]));
  // Independent writers may advance usage, provided this whole batch still fits.
  conditions.push(`coalesce((SELECT new_receipts FROM ingest_daily_usage WHERE project_id = ? AND utc_date = ?), 0)
    <= new_receipts_per_utc_day - ?`);
  bindings.push(batch.projectId, new Date(batch.receivedAt).toISOString().slice(0, 10), newReceipts);
  return { sql: conditions.join(' AND '), bindings };
}
