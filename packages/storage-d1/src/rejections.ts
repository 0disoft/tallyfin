import { addCounts, closed, CollectionError, count, dateMillis, DAY, integer, REJECTION_REASONS, rejectionRange } from '@tallyfin/core';
import type { AdminPrincipal, RejectionCounts, RejectionResponse, RejectionSummary } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';

const access = "EXISTS (SELECT 1 FROM project_grants WHERE project_id = ? AND issuer = ? AND subject = ? AND role IN ('reader','owner'))";
const invalid = (): never => { throw new CollectionError('storage_unavailable', 503); };
const empty = (): RejectionCounts => ({});
function merge(target: RejectionCounts, next: RejectionCounts): void {
  for (const reason of REJECTION_REASONS) {
    const bucket = next[reason]; if (!bucket) continue;
    const previous = target[reason];
    target[reason] = { count: addCounts(previous?.count ?? 0, bucket.count), lastRejectedAt: Math.max(previous?.lastRejectedAt ?? 0, bucket.lastRejectedAt) };
  }
}
function summarize(counts: RejectionCounts): RejectionSummary {
  const reasons = REJECTION_REASONS.map(reason => ({ reason, count: counts[reason]?.count ?? 0,
    lastRejectedAt: counts[reason] ? new Date(counts[reason]!.lastRejectedAt).toISOString() : null }));
  const timestamps = Object.values(counts).map(value => value!.lastRejectedAt);
  return { rejectedRequests: reasons.reduce((total, reason) => addCounts(total, reason.count), 0),
    lastRejectedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null, reasons };
}
function decode(json: string, minute: number): RejectionCounts {
  let value: unknown;
  try { value = JSON.parse(json); } catch { return invalid(); }
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > 2048 || !closed(value, [], [...REJECTION_REASONS])) return invalid();
  const output: RejectionCounts = {};
  for (const reason of REJECTION_REASONS) {
    const entry = value[reason]; if (entry === undefined) continue;
    if (!closed(entry, ['count', 'lastRejectedAt']) || !integer(entry.count, 1, reason === 'minute_limit' ? Number.MAX_SAFE_INTEGER : 600) ||
      !integer(entry.lastRejectedAt, minute, minute + 59_999)) return invalid();
    output[reason] = { count: count(entry.count), lastRejectedAt: entry.lastRejectedAt };
  }
  return output;
}

/** Project grant and minute rows are read in one transactional batch, with a bounded seven-day scan. */
export async function collectionRejections(db: SqlDatabase, principal: AdminPrincipal, projectId: string, from: string, to: string, now: number): Promise<RejectionResponse> {
  rejectionRange(projectId, from, to, now);
  const start = dateMillis(from), end = dateMillis(to) + DAY;
  const result = await db.batch<{ id: string; allowed: number } | { minute_start: number; rejections_json: string }>([
    db.prepare(`SELECT id, CASE WHEN ${access} THEN 1 ELSE 0 END AS allowed FROM projects WHERE id = ?`)
      .bind(projectId, principal.issuer, principal.subject, projectId),
    db.prepare(`SELECT minute_start, rejections_json FROM ingest_minute_usage WHERE project_id = ? AND minute_start >= ? AND minute_start < ?
      AND rejections_json != '{}' AND ${access} ORDER BY minute_start LIMIT 10081`)
      .bind(projectId, start, end, projectId, principal.issuer, principal.subject),
  ]);
  if (result.length !== 2 || result.some(row => !row.success || !Array.isArray(row.results))) return invalid();
  const project = result[0]!.results[0] as { id: string; allowed: number } | undefined;
  if (!project) throw new CollectionError('not_found', 404);
  if (project.allowed !== 1) throw new CollectionError('forbidden', 403);
  return rejectionResponse(projectId, from, to, now, result[1]!.results as RejectionMinuteRow[]);
}

export interface RejectionMinuteRow { minute_start: number; rejections_json: string }
/** Shared bounded decoder for detailed and overview reads. */
export function rejectionResponse(projectId: string, from: string, to: string, now: number, rows: RejectionMinuteRow[]): RejectionResponse {
  const dates = rejectionRange(projectId, from, to, now), start = dateMillis(from), end = dateMillis(to) + DAY;
  if (rows.length > 10080) return invalid();
  const daily = new Map(dates.map(date => [date, empty()])), total = empty(), seen = new Set<number>();
  for (const row of rows) {
    if (!integer(row.minute_start, start, end - 1) || row.minute_start % 60_000 !== 0 || seen.has(row.minute_start)) return invalid();
    seen.add(row.minute_start);
    const date = new Date(row.minute_start).toISOString().slice(0, 10), target = daily.get(date);
    if (!target) return invalid();
    const counts = decode(row.rejections_json, row.minute_start);
    merge(target, counts); merge(total, counts);
  }
  return { meta: { projectId, from, to, timeZone: 'UTC', dateBasis: 'receivedAt', generatedAt: new Date(now).toISOString(), retentionDays: 7, coverage: 'best-effort' },
    summary: summarize(total), days: dates.map(date => ({ date, ...summarize(daily.get(date)!) })) };
}
