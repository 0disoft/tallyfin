import type { CleanupPage } from '@tallyfin/storage-d1';

export const CLEANUP_PROJECT_LIMIT = 5;
export const CLEANUP_ROW_LIMIT = 500;
export interface RetentionStore {
  nextCleanupPage(limit: number): Promise<CleanupPage>;
  cleanup(projectId: string, timeZone: string, now: number, limit: number): Promise<void>;
  advanceCleanupCursor(page: CleanupPage): Promise<boolean>;
}
export interface CleanupReport { attempted: number; completed: number; failed: number; cursorAdvanced: boolean }

export async function runCleanup(store: RetentionStore, now: number): Promise<CleanupReport> {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw Error('invalid cleanup time');
  const page = await store.nextCleanupPage(CLEANUP_PROJECT_LIMIT);
  const report: CleanupReport = { attempted: 0, completed: 0, failed: 0, cursorAdvanced: false };
  for (const project of page.projects) {
    report.attempted++;
    try {
      await store.cleanup(project.id, project.timeZone, now, CLEANUP_ROW_LIMIT);
      report.completed++;
    } catch { report.failed++; }
  }
  // Even failed projects advance the cursor and retry on the next complete sweep.
  report.cursorAdvanced = await store.advanceCleanupCursor(page);
  return report;
}
