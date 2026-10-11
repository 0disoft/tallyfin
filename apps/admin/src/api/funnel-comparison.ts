import { parseFunnelResponse, type FunnelResponse } from './funnel-contract.ts';
import { countChange, previousRange, rateChange } from './period-comparison.ts';
import { ContractError } from './validate.ts';

export type FunnelComparisonRow = { key: string; label: string; stepIndex: number | null;
  current: number | null; previous: number | null; change: number | null; unit: '%' | '%p'; rate: boolean };

/** Compare one immutable definition and adjacent equal-length starting-day cohorts. */
export function compareFunnels(current: FunnelResponse, previous: FunnelResponse): FunnelComparisonRow[] {
  const now = parseFunnelResponse(current), before = parseFunnelResponse(previous), expected = previousRange(now.meta);
  if (now.meta.projectId !== before.meta.projectId || now.meta.schemaVersion !== before.meta.schemaVersion ||
    now.meta.timeZone !== before.meta.timeZone || now.funnelId !== before.funnelId ||
    before.meta.from !== expected.from || before.meta.to !== expected.to ||
    JSON.stringify(now.definition) !== JSON.stringify(before.definition))
    throw new ContractError('퍼널 비교의 프로젝트·버전·정의·직전 기간이 현재 조회와 맞지 않아요.');
  const rows: FunnelComparisonRow[] = [];
  const append = (key: string, label: string, current: number | null, previous: number | null, rate = false, stepIndex: number | null = null) => {
    rows.push({ key, label, current, previous, rate, stepIndex,
      change: rate ? rateChange(current, previous) : countChange(current, previous), unit: rate ? '%p' : '%' });
  };
  append('started', '시작 실행', now.summary.startedRuns, before.summary.startedRuns);
  append('completed', '완료 실행', now.summary.completedRuns, before.summary.completedRuns);
  append('completion', '완료율', now.summary.completionRate, before.summary.completionRate, true);
  now.summary.steps.forEach((step, index) => {
    const previousStep = before.summary.steps[index]!;
    const prefix = `${index + 1}단계`;
    append(`step:${index}:reached`, `${prefix} 도달`, step.reachedRuns, previousStep.reachedRuns, false, index);
    append(`step:${index}:reach-rate`, `${prefix} 첫 단계 대비 도달률`, step.reachRate, previousStep.reachRate, true, index);
    append(`step:${index}:conversion`, `${prefix} 직전 단계 대비 전환율`, step.conversionRate, previousStep.conversionRate, true, index);
  });
  return rows;
}
