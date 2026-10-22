import { addCounts, CollectionError, dateMillis, DAY, integer, rejectionRange } from '@tallyfin/core';
import type { AdminPrincipal } from '@tallyfin/core';
import { rejectionMinuteCounts } from './rejections.ts';
import type { RejectionMinuteRow } from './rejections.ts';
import type { SqlDatabase } from './sql.ts';

// Three pages cover seven days. Sequential projects keep at most 8 MiB of raw JSON per result.
export const OVERVIEW_REJECTION_PAGE_SIZE = 4096;
const MAX_REJECTION_MINUTES = 7 * 24 * 60;
const access = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = p.id AND g.issuer = ? AND g.subject = ? AND g.role IN ('reader','owner'))";
const invalid = (): never => { throw new CollectionError('storage_unavailable', 503); };
type Project = { latest_received_at: number | null };

/** Best-effort keyset scan. Never retain raw pages or return a partial sum after failure/denial. */
export async function overviewRejections(db: SqlDatabase, principal: AdminPrincipal, projectId: string,
  from: string, to: string, now: number, signal?: AbortSignal): Promise<{ rejected: number; latestReceivedAt: number | null }> {
  rejectionRange(projectId, from, to, now);
  const start = dateMillis(from), end = dateMillis(to) + DAY;
  let after = start - 1, total = 0, read = 0;
  for (let page = 0; page < Math.ceil(MAX_REJECTION_MINUTES / OVERVIEW_REJECTION_PAGE_SIZE); page++) {
    signal?.throwIfAborted();
    const result = await db.batch<Project | RejectionMinuteRow>([
      db.prepare(`SELECT p.latest_received_at FROM projects p WHERE p.id = ? AND ${access}`)
        .bind(projectId, principal.issuer, principal.subject),
      db.prepare(`SELECT u.minute_start, u.rejections_json FROM ingest_minute_usage u
        WHERE u.project_id = ? AND u.minute_start >= ? AND u.minute_start < ? AND u.minute_start > ?
        AND u.rejections_json != '{}' AND EXISTS (SELECT 1 FROM projects p WHERE p.id = u.project_id AND ${access})
        ORDER BY u.minute_start LIMIT ${OVERVIEW_REJECTION_PAGE_SIZE}`)
        .bind(projectId, start, end, after, principal.issuer, principal.subject),
    ]);
    signal?.throwIfAborted();
    if (result.length !== 2 || result.some(r => !r.success || !Array.isArray(r.results))) return invalid();
    const project = result[0]!.results[0] as Project | undefined;
    if (!project) throw new CollectionError('forbidden', 403);
    if (project.latest_received_at !== null && !integer(project.latest_received_at, 0, 8_640_000_000_000_000)) return invalid();
    const rows = result[1]!.results as RejectionMinuteRow[];
    if (rows.length > OVERVIEW_REJECTION_PAGE_SIZE || (read += rows.length) > MAX_REJECTION_MINUTES) return invalid();
    for (const row of rows) {
      if (row.minute_start <= after) return invalid();
      const counts = rejectionMinuteCounts(row, start, end);
      for (const bucket of Object.values(counts)) total = addCounts(total, bucket!.count);
      after = row.minute_start;
    }
    if (rows.length < OVERVIEW_REJECTION_PAGE_SIZE) return { rejected: total, latestReceivedAt: project.latest_received_at };
  }
  return invalid();
}
