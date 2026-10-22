import { CLEANUP_STOP_REASONS, cleanupFailed } from '../../apps/collector/src/cleanup-report.ts';
import type { CleanupExecution, CleanupReport, CleanupStopReason } from '../../apps/collector/src/cleanup-report.ts';
import { CLEANUP_LOG_PROJECT_LIMIT } from './cleanup-metrics.ts';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const closed = (value: Record<string, unknown>, keys: string[], optional: string[] = []) =>
  keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));

export function validCleanupExecution(value: unknown, report: Pick<CleanupReport, 'attempted' | 'completed' | 'failed' | 'cursorAdvanced'>): value is CleanupExecution {
  if (!record(value) || !closed(value, ['elapsedMs', 'stopReason', 'interruptedProjects', 'checkpointedProjects'], ['scheduleLagMs']) ||
    !count(value.elapsedMs) || !CLEANUP_STOP_REASONS.includes(value.stopReason as CleanupStopReason) ||
    !count(value.interruptedProjects, 1) || !count(value.checkpointedProjects, report.attempted) ||
    (Object.hasOwn(value, 'scheduleLagMs') && !count(value.scheduleLagMs, 8_640_000_000_000_000))) return false;
  if (report.attempted !== report.completed + report.failed + value.interruptedProjects ||
    value.checkpointedProjects > report.completed + report.failed) return false;
  if (value.stopReason === 'cursor_conflict' && report.cursorAdvanced) return false;
  if (['cancelled', 'storage_error', 'cursor_conflict'].includes(String(value.stopReason)))
    return value.stopReason !== 'cursor_conflict' || value.interruptedProjects === 0;
  return value.interruptedProjects === 0 && value.checkpointedProjects === report.attempted;
}

export interface CleanupExecutionSummary {
  reportedRuns: number; interruptedProjects: number; checkpointedProjects: number; maxElapsedMs: number;
  scheduleLagSamples: number; maxScheduleLagMs: number | null;
  failedRuns: number; cursorNotAdvancedRuns: number;
  stopReasons: { reason: CleanupStopReason; runs: number }[];
}
export function summarizeCleanupExecution(reports: readonly CleanupReport[]): CleanupExecutionSummary | undefined {
  const measured = reports.filter(report => report.execution);
  if (!measured.length) return;
  const summary: CleanupExecutionSummary = { reportedRuns: measured.length, interruptedProjects: 0, checkpointedProjects: 0,
    maxElapsedMs: 0, scheduleLagSamples: 0, maxScheduleLagMs: null, failedRuns: 0, cursorNotAdvancedRuns: 0, stopReasons: [] };
  const reasons = new Map<CleanupStopReason, number>();
  for (const report of measured) {
    const execution = report.execution!;
    if (cleanupFailed(report)) summary.failedRuns++;
    if (!report.cursorAdvanced) summary.cursorNotAdvancedRuns++;
    summary.interruptedProjects += execution.interruptedProjects; summary.checkpointedProjects += execution.checkpointedProjects;
    summary.maxElapsedMs = Math.max(summary.maxElapsedMs, execution.elapsedMs);
    if (execution.scheduleLagMs !== undefined) {
      summary.scheduleLagSamples++; summary.maxScheduleLagMs = Math.max(summary.maxScheduleLagMs ?? 0, execution.scheduleLagMs);
    }
    reasons.set(execution.stopReason, (reasons.get(execution.stopReason) ?? 0) + 1);
  }
  summary.stopReasons = CLEANUP_STOP_REASONS.flatMap(reason => reasons.has(reason) ? [{ reason, runs: reasons.get(reason)! }] : []);
  return summary;
}

/** Shared with the browser: legacy summaries may omit execution data entirely. */
export function validCleanupExecutionSummary(value: unknown, summary: {
  reportedRuns: number; attemptedProjects: number; completedProjects: number; failedProjects: number; cursorNotAdvancedReports: number;
}): value is CleanupExecutionSummary {
  if (!record(value) || !closed(value, ['reportedRuns', 'interruptedProjects', 'checkpointedProjects', 'maxElapsedMs', 'scheduleLagSamples', 'maxScheduleLagMs', 'failedRuns', 'cursorNotAdvancedRuns', 'stopReasons']) ||
    !count(value.reportedRuns, summary.reportedRuns) || value.reportedRuns === 0 ||
    !count(value.interruptedProjects, value.reportedRuns) || !count(value.checkpointedProjects, summary.completedProjects + summary.failedProjects) ||
    !count(value.maxElapsedMs) || !count(value.scheduleLagSamples, value.reportedRuns) ||
    !count(value.failedRuns, value.reportedRuns) || !count(value.cursorNotAdvancedRuns, Math.min(value.reportedRuns, summary.cursorNotAdvancedReports)) ||
    summary.cursorNotAdvancedReports - value.cursorNotAdvancedRuns > summary.reportedRuns - value.reportedRuns ||
    (value.scheduleLagSamples === 0 ? value.maxScheduleLagMs !== null : !count(value.maxScheduleLagMs, 8_640_000_000_000_000)) ||
    !Array.isArray(value.stopReasons) || value.stopReasons.length > CLEANUP_STOP_REASONS.length ||
    summary.attemptedProjects !== summary.completedProjects + summary.failedProjects + value.interruptedProjects) return false;
  let total = 0, interruptedRuns = 0, errorRuns = 0; const seen = new Set<string>();
  for (const row of value.stopReasons) {
    if (!record(row) || !closed(row, ['reason', 'runs']) || !CLEANUP_STOP_REASONS.includes(row.reason as CleanupStopReason) ||
      !count(row.runs, value.reportedRuns) || row.runs === 0 || seen.has(String(row.reason))) return false;
    seen.add(String(row.reason)); total += row.runs;
    if (row.reason === 'cancelled' || row.reason === 'storage_error') interruptedRuns += row.runs;
    if (['cancelled', 'storage_error', 'cursor_conflict'].includes(String(row.reason))) errorRuns += row.runs;
  }
  const legacyCapacity = (summary.reportedRuns - value.reportedRuns) * CLEANUP_LOG_PROJECT_LIMIT;
  const knownFailedMinimum = Math.ceil(Math.max(0, summary.failedProjects - legacyCapacity) / CLEANUP_LOG_PROJECT_LIMIT);
  return total === value.reportedRuns && value.interruptedProjects <= interruptedRuns &&
    value.failedRuns >= Math.max(errorRuns, knownFailedMinimum) && value.failedRuns <= Math.min(value.reportedRuns, errorRuns + summary.failedProjects) &&
    (errorRuns > 0 || value.reportedRuns !== summary.reportedRuns || value.checkpointedProjects === summary.attemptedProjects);
}
