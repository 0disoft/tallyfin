import type { CleanupPage, CleanupMetrics } from '@tallyfin/storage-d1';
import type { CleanupRunReport } from './cleanup-report.ts';
export type { CleanupReport } from './cleanup-report.ts';

export const CLEANUP_PROJECT_LIMIT = 4;
export const CLEANUP_ROW_LIMIT = 500;
export const CLEANUP_MAX_ROW_LIMIT = 10_000;
export const CLEANUP_PAGE_LIMIT = 4;
export const CLEANUP_DEFAULT_PAGE_LIMIT = 1; // Keep the D1 Free 50-query invocation budget.
export const CLEANUP_RUN_PROJECT_LIMIT = CLEANUP_PROJECT_LIMIT * CLEANUP_PAGE_LIMIT;
export const CLEANUP_BUDGET_MS = 20_000;
export interface RetentionStore {
  nextCleanupPage(limit: number): Promise<CleanupPage>;
  cleanup(projectId: string, timeZone: string, now: number, limit: number): Promise<void>;
  cleanupReport?(projectId: string, timeZone: string, now: number, limit: number): Promise<CleanupMetrics>;
  advanceCleanupCursor(page: CleanupPage): Promise<boolean>;
}

export function cleanupPageLimit(value = CLEANUP_DEFAULT_PAGE_LIMIT): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > CLEANUP_PAGE_LIMIT) throw new TypeError('Invalid cleanup page limit');
  return value;
}

export async function runCleanup(store: RetentionStore, now: number,
  options: { clock?: () => number; signal?: AbortSignal; maxPages?: number; onReport?: (report: CleanupRunReport) => void } = {}): Promise<CleanupRunReport> {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw Error('invalid cleanup time');
  const maxPages = cleanupPageLimit(options.maxPages);
  const clock = options.clock ?? (() => performance.now()), started = clock();
  const withinBudget = () => clock() - started < CLEANUP_BUDGET_MS;
  const report: CleanupRunReport = { attempted: 0, completed: 0, failed: 0, cursorAdvanced: false,
    execution: { elapsedMs: 0, stopReason: 'page_limit', interruptedProjects: 0, checkpointedProjects: 0 } };
  const seen = new Set<string>();
  try {
  for (let index = 0; index < maxPages; index++) {
    options.signal?.throwIfAborted();
    if (!withinBudget()) { report.execution.stopReason = 'time_budget'; break; }
    const page = await store.nextCleanupPage(CLEANUP_PROJECT_LIMIT);
    const attempted: CleanupPage['projects'] = [];
    for (const project of page.projects) {
      options.signal?.throwIfAborted();
      if (seen.has(project.id)) { report.execution.stopReason = 'cycle_complete'; break; }
      if (!withinBudget()) { report.execution.stopReason = 'time_budget'; break; }
      seen.add(project.id); attempted.push(project); report.attempted++;
      try {
        // A per-minute cron visits a project every ceil(projects / per-run projects) minutes.
        // Twice the configured daily input rate gives headroom for backlog and skipped ticks.
        const visits = Math.ceil((page.projectCount ?? 0) / (CLEANUP_PROJECT_LIMIT * maxPages));
        const requested = Math.max(CLEANUP_ROW_LIMIT, Math.ceil((project.dailyLimit ?? 0) * visits * 2 / 1440));
        const limit = Math.min(CLEANUP_MAX_ROW_LIMIT, requested);
        if (store.cleanupReport) {
          const result = await store.cleanupReport(project.id, project.timeZone, now, limit);
          const metrics = report.metrics ??= { deletedRows: 0, saturatedTables: 0, oldestExpiredReceiptAgeMs: null, measuredProjects: 0, capacityLimitedProjects: 0 };
          metrics.deletedRows += result.deletedRows; metrics.saturatedTables += result.saturatedTables;
          metrics.measuredProjects++; if (requested > limit) metrics.capacityLimitedProjects++;
          if (result.oldestExpiredReceiptAgeMs !== null)
            metrics.oldestExpiredReceiptAgeMs = Math.max(metrics.oldestExpiredReceiptAgeMs ?? 0, result.oldestExpiredReceiptAgeMs);
        } else await store.cleanup(project.id, project.timeZone, now, limit);
        report.completed++;
      } catch {
        options.signal?.throwIfAborted();
        report.failed++;
      }
    }
    // Persist only the attempted prefix, including failed projects, before another page.
    if (!attempted.length && page.projects.length) break;
    options.signal?.throwIfAborted();
    report.cursorAdvanced = await store.advanceCleanupCursor(attempted.length === page.projects.length
      ? page : { revision: page.revision, projects: attempted });
    if (!report.cursorAdvanced) { report.execution.stopReason = 'cursor_conflict'; break; }
    report.execution.checkpointedProjects += attempted.length;
    if (!page.projects.length) { report.execution.stopReason = 'empty_page'; break; }
    if (attempted.length < page.projects.length) break;
  }
  return report;
  } catch (cause) {
    report.execution.stopReason = options.signal?.aborted ? 'cancelled' : 'storage_error';
    throw cause;
  } finally {
    report.execution.elapsedMs = Math.max(0, Math.floor(clock() - started));
    report.execution.interruptedProjects = report.attempted - report.completed - report.failed;
    // Reporting must never replace an original storage error/cancellation, or invalidate completed work.
    try { options.onReport?.(structuredClone(report)); } catch { /* The optional observer owns its diagnostics sink. */ }
  }
}
