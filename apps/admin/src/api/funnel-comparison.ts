import { parseFunnelCounts, parseFunnelResponse, type FunnelCounts, type FunnelResponse } from './funnel-contract.ts';
import { countChange, previousRange, rateChange } from './period-comparison.ts';
import { ContractError } from './validate.ts';

export type FunnelComparisonRow = { key: string; label: string; stepIndex: number | null;
  current: number | null; previous: number | null; change: number | null; unit: '%' | '%p'; rate: boolean };

/** Compare one immutable definition and adjacent equal-length starting-day cohorts. */
export function compareFunnels(current: FunnelResponse, previous: FunnelResponse): FunnelComparisonRow[] {
  const now = parseFunnelResponse(current), before = parseFunnelResponse(previous);
  assertFunnelComparison(now, before);
  return compareFunnelCounts(now.summary, before.summary);
}
export function assertFunnelComparison(now: Pick<FunnelResponse, 'meta' | 'funnelId' | 'definition'>,
  before: Pick<FunnelResponse, 'meta' | 'funnelId' | 'definition'>): void {
  const expected = previousRange(now.meta);
  if (now.meta.projectId !== before.meta.projectId || now.meta.schemaVersion !== before.meta.schemaVersion ||
    now.meta.timeZone !== before.meta.timeZone || now.funnelId !== before.funnelId ||
    before.meta.from !== expected.from || before.meta.to !== expected.to ||
    JSON.stringify(now.definition) !== JSON.stringify(before.definition))
    throw new ContractError('퍼널 비교의 프로젝트·버전·정의·직전 기간이 현재 조회와 맞지 않아요.');
}
export function compareFunnelCounts(current: FunnelCounts, previous: FunnelCounts): FunnelComparisonRow[] {
  const length = current.steps.length;
  if (length < 2 || length > 10) throw new ContractError('퍼널 비교의 단계 수가 맞지 않아요.');
  const now = parseFunnelCounts(current, length), before = parseFunnelCounts(previous, length);
  const rows: FunnelComparisonRow[] = [];
  const append = (key: string, label: string, current: number | null, previous: number | null, rate = false, stepIndex: number | null = null) => {
    rows.push({ key, label, current, previous, rate, stepIndex,
      change: rate ? rateChange(current, previous) : countChange(current, previous), unit: rate ? '%p' : '%' });
  };
  append('started', '시작 실행', now.startedRuns, before.startedRuns);
  append('completed', '완료 실행', now.completedRuns, before.completedRuns);
  append('completion', '완료율', now.completionRate, before.completionRate, true);
  now.steps.forEach((step, index) => {
    const previousStep = before.steps[index]!;
    const prefix = `${index + 1}단계`;
    append(`step:${index}:reached`, `${prefix} 도달`, step.reachedRuns, previousStep.reachedRuns, false, index);
    append(`step:${index}:reach-rate`, `${prefix} 첫 단계 대비 도달률`, step.reachRate, previousStep.reachRate, true, index);
    append(`step:${index}:conversion`, `${prefix} 직전 단계 대비 전환율`, step.conversionRate, previousStep.conversionRate, true, index);
  });
  return rows;
}
