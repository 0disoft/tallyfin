import { addCounts, CollectionError, count, dateEnd, DAY, funnelCounts, integer } from '@tallyfin/core';
import type { AdminQuery, FunnelBreakdownResponse, FunnelQueryMeta, Registry } from '@tallyfin/core';
import { readDimensions } from './dimensions.ts';

export interface FunnelDimensionRow { cohort_date: string; dimension_key: string; step_index: number; reached_count: number }
export const FUNNEL_DIMENSION_ROW_LIMIT = 31 * 256 * 10;
function invalid(): never { throw new CollectionError('storage_unavailable', 503); }

/** Read finite start-cohort dimensions already persisted alongside step counts.
 * Validate each full combination before collapsing other dimensions; corruption
 * in one combination cannot be hidden by valid counts in another.
 */
export function funnelBreakdown(registry: Registry, input: AdminQuery, meta: FunnelQueryMeta,
  dates: string[], rows: FunnelDimensionRow[], now: number): FunnelBreakdownResponse {
  const definition = registry.funnels?.find(funnel => funnel.id === input.name);
  if (!definition) throw new CollectionError('not_found', 404);
  if (!input.groupBy || !definition.dimensions.includes(input.groupBy)) throw new CollectionError('invalid_request', 400);
  const first = definition.steps[0]!;
  const start = registry.events.find(event => event.name === first.eventName && event.source === first.source)!;
  const rules = Object.fromEntries(definition.dimensions.map(name => [name, start.properties[name]!])) as typeof start.properties;
  const size = definition.steps.length, empty = () => Array<number>(size).fill(0);
  if (rows.length > dates.length * 256 * size || rows.length > FUNNEL_DIMENSION_ROW_LIMIT) invalid();
  const validDates = new Set(dates), groups = new Map<string, { value: string | number | boolean; total: number[]; days: Map<string, number[]> }>();
  const combinations = new Map<string, { counts: number[]; seen: Set<number> }>();
  const combinationKeys = new Set<string>(), total = empty();
  for (const row of rows) {
    if (!validDates.has(row.cohort_date) || !integer(row.step_index, 0, size - 1) ||
      typeof row.dimension_key !== 'string' || new TextEncoder().encode(row.dimension_key).length > 512) invalid();
    let props: ReturnType<typeof readDimensions>;
    try { props = readDimensions(row.dimension_key, rules); } catch { invalid(); }
    const value = props[input.groupBy];
    if (value === undefined) invalid();
    const key = JSON.stringify(definition.dimensions.map(name => [name, typeof props[name], props[name]]));
    combinationKeys.add(key);
    if (combinationKeys.size > 256) invalid();
    const combinationId = JSON.stringify([row.cohort_date, key]);
    const combination = combinations.get(combinationId) ?? { counts: empty(), seen: new Set<number>() };
    if (combination.seen.has(row.step_index)) invalid();
    combination.seen.add(row.step_index); combination.counts[row.step_index] = count(row.reached_count);
    combinations.set(combinationId, combination);
    const bucketId = JSON.stringify([typeof value, value]);
    const bucket = groups.get(bucketId) ?? { value, total: empty(), days: new Map<string, number[]>() };
    if (!groups.has(bucketId) && groups.size >= 32) invalid();
    const day = bucket.days.get(row.cohort_date) ?? empty();
    day[row.step_index] = addCounts(day[row.step_index]!, row.reached_count);
    bucket.total[row.step_index] = addCounts(bucket.total[row.step_index]!, row.reached_count);
    total[row.step_index] = addCounts(total[row.step_index]!, row.reached_count);
    bucket.days.set(row.cohort_date, day); groups.set(bucketId, bucket);
  }
  for (const combination of combinations.values()) funnelCounts(combination.counts);
  // Reuse within this response only; a later request must reevaluate freshness.
  const dayStates = groups.size ? dates.map(date => ({ date, provisional: now < dateEnd(date, meta.timeZone) + 2 * DAY })) : [];
  return { meta, funnelId: definition.id, definition, cohortBasis: 'startedAt', groupBy: input.groupBy,
    summary: funnelCounts(total), buckets: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => ({
      value: bucket.value, summary: funnelCounts(bucket.total), days: dayStates.map(({ date, provisional }) => ({ date,
        ...funnelCounts(bucket.days.get(date) ?? empty()), provisional })) })) };
}
