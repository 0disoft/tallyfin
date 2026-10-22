import type { CleanupMetrics } from '@tallyfin/storage-d1';

export const CLEANUP_STOP_REASONS = ['page_limit', 'time_budget', 'cycle_complete', 'empty_page', 'cursor_conflict', 'cancelled', 'storage_error'] as const;
export type CleanupStopReason = typeof CLEANUP_STOP_REASONS[number];
export interface CleanupExecution {
  elapsedMs: number; stopReason: CleanupStopReason; interruptedProjects: number; checkpointedProjects: number;
  scheduleLagMs?: number;
}
export interface CleanupReport {
  attempted: number; completed: number; failed: number; cursorAdvanced: boolean;
  metrics?: CleanupMetrics & { measuredProjects: number; capacityLimitedProjects: number };
  /** Absent in logs written before execution diagnostics were introduced. */
  execution?: CleanupExecution;
}
export type CleanupRunReport = CleanupReport & { execution: CleanupExecution };

/** A traversal limit is a deferral, not evidence of a failed deletion or a fully drained database. */
export function cleanupFailed(report: CleanupReport): boolean {
  if (report.failed > 0) return true;
  return report.execution ? ['cursor_conflict', 'cancelled', 'storage_error'].includes(report.execution.stopReason) : !report.cursorAdvanced;
}
