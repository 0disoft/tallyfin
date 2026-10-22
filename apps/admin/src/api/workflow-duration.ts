import { ContractError } from './validate.ts';
import type { WorkflowResponse, WorkflowSummary } from './types.ts';

export const DURATION_RANGES = [
  ['under_1s', '1초 미만'], ['1s_to_5s', '1초 이상 ~ 5초 미만'], ['5s_to_30s', '5초 이상 ~ 30초 미만'],
  ['30s_to_2m', '30초 이상 ~ 2분 미만'], ['2m_to_10m', '2분 이상 ~ 10분 미만'], ['10m_to_24h', '10분 이상 ~ 24시간 이하'],
] as const;
export type WorkflowDuration = { measuredAttempts: number; unmeasuredAttempts: number;
  buckets: { range: typeof DURATION_RANGES[number][0]; succeededAttempts: number; failedAttempts: number | null }[] };
function invalid(): never { throw new ContractError('소요시간 분포의 구간·건수·측정 범위가 맞지 않아요.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value; }
export function parseWorkflowDuration(value: unknown, summary: WorkflowSummary): WorkflowDuration {
  const row = object(value, ['measuredAttempts', 'unmeasuredAttempts', 'buckets']);
  if (!Array.isArray(row.buckets) || row.buckets.length !== DURATION_RANGES.length) invalid();
  const buckets = row.buckets.map((value, index) => {
    const bucket = object(value, ['range', 'succeededAttempts', 'failedAttempts']);
    const range = DURATION_RANGES[index]![0];
    if (bucket.range !== range || (bucket.failedAttempts === null) !== (summary.failedAttempts === null)) invalid();
    return { range, succeededAttempts: count(bucket.succeededAttempts), failedAttempts: bucket.failedAttempts === null ? null : count(bucket.failedAttempts) };
  });
  const success = buckets.reduce((sum, bucket) => count(sum + bucket.succeededAttempts), 0);
  const failed = buckets.reduce((sum, bucket) => count(sum + (bucket.failedAttempts ?? 0)), 0);
  const measuredAttempts = count(row.measuredAttempts), unmeasuredAttempts = count(row.unmeasuredAttempts);
  if (success > count(summary.succeededAttempts) || failed > count(summary.failedAttempts ?? 0) || count(success + failed) !== measuredAttempts ||
    count(measuredAttempts + unmeasuredAttempts) !== count(summary.succeededAttempts + (summary.failedAttempts ?? 0))) invalid();
  return { measuredAttempts, unmeasuredAttempts, buckets };
}
export function validateWorkflowDurations(response: Pick<WorkflowResponse, 'duration' | 'days' | 'summary'>): void {
  if (response.duration === undefined) { if (response.days.some(day => day.duration !== undefined)) invalid(); return; }
  const total = parseWorkflowDuration(response.duration, response.summary);
  const days = response.days.map(day => parseWorkflowDuration(day.duration, day));
  if (days.reduce((sum, day) => count(sum + day.measuredAttempts), 0) !== total.measuredAttempts ||
    days.reduce((sum, day) => count(sum + day.unmeasuredAttempts), 0) !== total.unmeasuredAttempts) invalid();
  total.buckets.forEach((bucket, index) => {
    if (days.reduce((sum, day) => count(sum + day.buckets[index]!.succeededAttempts), 0) !== bucket.succeededAttempts ||
      days.reduce((sum, day) => count(sum + (day.buckets[index]!.failedAttempts ?? 0)), 0) !== (bucket.failedAttempts ?? 0)) invalid();
  });
}
export function durationAvailability(value: WorkflowDuration | undefined) {
  if (!value) return 'unavailable';
  if (value.measuredAttempts) return value.unmeasuredAttempts ? 'partial' : 'complete';
  return value.unmeasuredAttempts ? 'unmeasured' : 'no_completed_attempts';
}
