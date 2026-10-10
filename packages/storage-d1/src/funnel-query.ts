import { addCounts, CollectionError, count, dateEnd, DAY, funnelCounts, integer } from '@tallyfin/core';
import type { AdminQuery, FunnelQueryMeta, FunnelResponse, Registry } from '@tallyfin/core';

export interface FunnelCountRow { cohort_date: string; step_index: number; reached_count: number }

/** SQL has already combined all registered dimension combinations and step sources. */
export function funnelSeries(registry: Registry, input: AdminQuery, meta: FunnelQueryMeta,
  dates: string[], rows: FunnelCountRow[], now: number): FunnelResponse {
  const definition = registry.funnels?.find(funnel => funnel.id === input.name);
  if (!definition) throw new CollectionError('not_found', 404);
  if (rows.length > dates.length * definition.steps.length) throw new CollectionError('storage_unavailable', 503);
  const totals = Array<number>(definition.steps.length).fill(0);
  const byDate = new Map(dates.map(date => [date, Array<number>(definition.steps.length).fill(0)]));
  const seen = new Set<string>();
  for (const row of rows) {
    const day = byDate.get(row.cohort_date), key = `${row.cohort_date}/${row.step_index}`;
    if (!day || !integer(row.step_index, 0, definition.steps.length - 1) || seen.has(key))
      throw new CollectionError('storage_unavailable', 503);
    seen.add(key); day[row.step_index] = count(row.reached_count);
    totals[row.step_index] = addCounts(totals[row.step_index]!, row.reached_count);
  }
  const days = dates.map(date => ({ date, ...funnelCounts(byDate.get(date)!),
    provisional: now < dateEnd(date, meta.timeZone) + 2 * DAY }));
  return { meta, funnelId: definition.id, definition, cohortBasis: 'startedAt', summary: funnelCounts(totals), days };
}
