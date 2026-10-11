import { parseFunnelBreakdown, type FunnelBreakdown, type FunnelBucketValue } from './funnel-breakdown.ts';
import { assertFunnelComparison, compareFunnelCounts, type FunnelComparisonRow } from './funnel-comparison.ts';
import type { FunnelCounts } from './funnel-contract.ts';
import { ContractError } from './validate.ts';

export const funnelValueKey = (value: FunnelBucketValue): string => JSON.stringify([typeof value, value]);
export type FunnelBucketComparison = { value: FunnelBucketValue; current: FunnelCounts; previous: FunnelCounts; rows: FunnelComparisonRow[] };

/** Absent buckets mean no observed starts, never an invented completion rate. */
export function compareFunnelBreakdowns(current: FunnelBreakdown, previous: FunnelBreakdown): FunnelBucketComparison[] {
  const now = parseFunnelBreakdown(current), before = parseFunnelBreakdown(previous);
  assertFunnelComparison(now, before);
  if (now.groupBy !== before.groupBy) throw new ContractError('퍼널 비교의 속성 분류 기준이 맞지 않아요.');
  const empty: FunnelCounts = { startedRuns: 0, completedRuns: 0, completionRate: null,
    steps: now.definition.steps.map((_, index, steps) => ({ stepIndex: index, reachedRuns: 0, reachRate: null,
      conversionRate: null, notReachedNext: index + 1 < steps.length ? 0 : null })) };
  const left = new Map(now.buckets.map(bucket => [funnelValueKey(bucket.value), bucket]));
  const right = new Map(before.buckets.map(bucket => [funnelValueKey(bucket.value), bucket]));
  return [...new Set([...left.keys(), ...right.keys()])].map(key => {
    const a = left.get(key), b = right.get(key), current = a?.summary ?? empty, previous = b?.summary ?? empty;
    return { value: (a ?? b)!.value, current, previous, rows: compareFunnelCounts(current, previous) };
  });
}
