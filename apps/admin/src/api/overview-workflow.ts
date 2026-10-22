import { ContractError } from './validate.ts';

export type WorkflowSample = { startedAttempts: number; succeededAttempts: number; failedAttempts: number | null;
  pendingAttempts: number; provisional: boolean };
export type WorkflowStats = { current: WorkflowSample; previous: WorkflowSample };
/** A display guard, not a statistical significance test or an alert threshold. */
export const OVERVIEW_MIN_COMPARISON_STARTS = 30;
const fail = (): never => { throw new ContractError('Service overview workflow sample is inconsistent.'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail();
  return value as Record<string, unknown>;
}
function sample(value: unknown, rate: number | null): WorkflowSample {
  const row = object(value, ['startedAttempts', 'succeededAttempts', 'failedAttempts', 'pendingAttempts', 'provisional']);
  for (const key of ['startedAttempts', 'succeededAttempts', 'failedAttempts', 'pendingAttempts'])
    if (!(key === 'failedAttempts' && row[key] === null) && (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || row[key] < 0)) fail();
  const result = row as WorkflowSample;
  if (typeof result.provisional !== 'boolean' || result.succeededAttempts > result.startedAttempts ||
    (result.failedAttempts ?? 0) > result.startedAttempts - result.succeededAttempts ||
    result.pendingAttempts !== result.startedAttempts - result.succeededAttempts - (result.failedAttempts ?? 0) ||
    rate !== (result.startedAttempts ? result.succeededAttempts / result.startedAttempts * 100 : null)) fail();
  return result;
}
export function parseWorkflowStats(value: unknown, currentRate: number | null, previousRate: number | null): WorkflowStats {
  const row = object(value, ['current', 'previous']);
  return { current: sample(row.current, currentRate), previous: sample(row.previous, previousRate) };
}
export function workflowComparison(stats: WorkflowStats | null | undefined, current: number | null, previous: number | null): { delta: number | null; reason: string | null } {
  if (!stats) return { delta: null, reason: '표본 정보 없음' };
  if (!stats.current.startedAttempts || !stats.previous.startedAttempts) return { delta: null, reason: '비교할 시작 기록 없음' };
  if (stats.current.provisional || stats.previous.provisional) return { delta: null, reason: '집계 중 · 비교 보류' };
  if (Math.min(stats.current.startedAttempts, stats.previous.startedAttempts) < OVERVIEW_MIN_COMPARISON_STARTS)
    return { delta: null, reason: '표본 적음 · 비교 보류' };
  return { delta: current === null || previous === null ? null : current - previous, reason: null };
}
