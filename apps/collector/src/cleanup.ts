import type { CleanupPage } from '@tallyfin/storage-d1';

export const CLEANUP_PROJECT_LIMIT = 5;
export const CLEANUP_ROW_LIMIT = 500;
export const CLEANUP_PAGE_LIMIT = 4;
export const CLEANUP_DEFAULT_PAGE_LIMIT = 1; // Keep the D1 Free 50-query invocation budget.
export const CLEANUP_RUN_PROJECT_LIMIT = CLEANUP_PROJECT_LIMIT * CLEANUP_PAGE_LIMIT;
export const CLEANUP_BUDGET_MS = 20_000;
export interface RetentionStore {
  nextCleanupPage(limit: number): Promise<CleanupPage>;
  cleanup(projectId: string, timeZone: string, now: number, limit: number): Promise<void>;
  advanceCleanupCursor(page: CleanupPage): Promise<boolean>;
}
export interface CleanupReport { attempted: number; completed: number; failed: number; cursorAdvanced: boolean }

export function cleanupPageLimit(value = CLEANUP_DEFAULT_PAGE_LIMIT): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > CLEANUP_PAGE_LIMIT) throw new TypeError('Invalid cleanup page limit');
  return value;
}

export async function runCleanup(store: RetentionStore, now: number,
  options: { clock?: () => number; signal?: AbortSignal; maxPages?: number } = {}): Promise<CleanupReport> {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw Error('invalid cleanup time');
  const maxPages = cleanupPageLimit(options.maxPages);
  const clock = options.clock ?? (() => performance.now()), started = clock();
  const withinBudget = () => clock() - started < CLEANUP_BUDGET_MS;
  const report: CleanupReport = { attempted: 0, completed: 0, failed: 0, cursorAdvanced: false };
  const seen = new Set<string>();
  for (let index = 0; index < maxPages; index++) {
    options.signal?.throwIfAborted();
    if (!withinBudget()) break;
    const page = await store.nextCleanupPage(CLEANUP_PROJECT_LIMIT);
    const attempted: CleanupPage['projects'] = [];
    for (const project of page.projects) {
      options.signal?.throwIfAborted();
      if (seen.has(project.id) || !withinBudget()) break;
      seen.add(project.id); attempted.push(project); report.attempted++;
      try {
        await store.cleanup(project.id, project.timeZone, now, CLEANUP_ROW_LIMIT);
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
    if (!report.cursorAdvanced || attempted.length < page.projects.length || !page.projects.length) break;
  }
  return report;
}
