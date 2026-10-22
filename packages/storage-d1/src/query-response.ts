import { ANALYTICS_ROW_LIMITS } from './policy.ts';
import { addCounts, CollectionError, count, dateEnd, DAY, workflowCounts } from '@tallyfin/core';
import type { AdminQuery, QueryMeta, Registry } from '@tallyfin/core';
import { readDimensions } from './dimensions.ts';
import { workflowBreakdown, type WorkflowDimensionRow } from './workflow-breakdown.ts';
import { funnelSeries, type FunnelCountRow } from './funnel-query.ts';
import { funnelBreakdown, type FunnelDimensionRow } from './funnel-breakdown.ts';

export interface EventRow { event_name: string; event_date: string; dimension_key: string; count: number }
export interface WorkflowRow { cohort_date: string; started_count: number; succeeded_count: number; failed_count: number }

export function queryResponse(registry: Registry, input: AdminQuery, meta: QueryMeta, dates: string[], rows: unknown[], now: number) {
  if (input.kind === 'funnel' || input.kind === 'funnel-breakdown') {
    const { source: _source, ...funnelMeta } = meta;
    if (input.kind === 'funnel-breakdown') return funnelBreakdown(registry, input, funnelMeta, dates, rows as FunnelDimensionRow[], now);
    return funnelSeries(registry, input, funnelMeta, dates, rows as FunnelCountRow[], now);
  }
  if (input.kind === 'summary') {
    const counts = new Map((rows as EventRow[]).map(row => [row.event_name, count(row.count)]));
    const definitions = registry.events.filter(e => e.source === meta.source);
    if (rows.length > ANALYTICS_ROW_LIMITS.summary || [...counts.keys()].some(name => !definitions.some(e => e.name === name))) throw new CollectionError('storage_unavailable', 503);
    const events = definitions.map(e => ({ name: e.name, count: counts.get(e.name) ?? 0 }));
    return { meta, totalEvents: events.reduce((sum, e) => addCounts(sum, e.count), 0), events };
  }
  if (input.kind === 'event') return eventSeries(registry, input, meta, dates, rows as EventRow[]);
  if (input.kind === 'workflow-breakdown') return workflowBreakdown(registry, input, meta, dates, rows as WorkflowDimensionRow[], now);
  const definition = registry.workflows.find(w => w.id === input.name);
  if (!definition) throw new CollectionError('not_found', 404);
  if (rows.length > ANALYTICS_ROW_LIMITS.days) throw new CollectionError('storage_unavailable', 503);
  const totals = { started: 0, succeeded: 0, failed: 0 };
  const byDate = new Map((rows as WorkflowRow[]).map(row => [row.cohort_date, row]));
  const days = dates.map(date => {
    const row = byDate.get(date);
    const started = count(row?.started_count ?? 0), succeeded = count(row?.succeeded_count ?? 0), failed = count(row?.failed_count ?? 0);
    totals.started = addCounts(totals.started, started); totals.succeeded = addCounts(totals.succeeded, succeeded); totals.failed = addCounts(totals.failed, failed);
    return { date, ...workflowCounts(started, succeeded, failed, definition.failureEvent !== null), provisional: now < dateEnd(date, meta.timeZone) + 2 * DAY };
  });
  return { meta, workflowId: definition.id, cohortBasis: 'startedAt',
    summary: workflowCounts(totals.started, totals.succeeded, totals.failed, definition.failureEvent !== null), days };
}

export function eventSeries(registry: Registry, input: AdminQuery, meta: QueryMeta, dates: string[], rows: EventRow[]) {
  const definition = registry.events.find(e => e.name === input.name && e.source === meta.source);
  if (!definition) throw new CollectionError('not_found', 404);
  if (input.groupBy && !Object.hasOwn(definition.properties, input.groupBy)) throw new CollectionError('invalid_request', 400);
  if (rows.length > ANALYTICS_ROW_LIMITS.dailyDimensions) throw new CollectionError('storage_unavailable', 503);
  const days = dates.map(date => ({ date, count: 0, breakdown: [] as { value: string | number | boolean | null; count: number }[] }));
  const byDate = new Map(days.map(d => [d.date, d]));
  for (const row of rows) {
    const day = byDate.get(row.event_date); if (!day) throw new CollectionError('storage_unavailable', 503);
    day.count = addCounts(day.count, row.count);
    if (input.groupBy) {
      const props = readDimensions(row.dimension_key, definition.properties);
      const value = Object.hasOwn(props, input.groupBy) ? props[input.groupBy]! : null;
      const existing = day.breakdown.find(b => b.value === value);
      if (existing) existing.count = addCounts(existing.count, row.count);
      else day.breakdown.push({ value, count: count(row.count) });
    }
  }
  for (const day of days) day.breakdown.sort((a, b) => JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
  return { meta, eventName: definition.name, groupBy: input.groupBy ?? null,
    totalEvents: days.reduce((sum, day) => addCounts(sum, day.count), 0), days };
}
