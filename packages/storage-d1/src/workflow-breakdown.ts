import { addCounts, CollectionError, count, dateEnd, DAY, workflowCounts } from '@tallyfin/core';
import type { AdminQuery, QueryMeta, Registry } from '@tallyfin/core';
import { readDimensions } from './dimensions.ts';

export interface WorkflowDimensionRow { cohort_date: string; dimension_key: string; started_count: number; succeeded_count: number; failed_count: number }
type Counts = { started: number; succeeded: number; failed: number };
const empty = (): Counts => ({ started: 0, succeeded: 0, failed: 0 });
export function workflowBreakdown(registry: Registry, input: AdminQuery, meta: QueryMeta, dates: string[], rows: WorkflowDimensionRow[], now: number) {
  const definition = registry.workflows.find(workflow => workflow.id === input.name);
  if (!definition) throw new CollectionError('not_found', 404);
  if (!input.groupBy || !definition.dimensions.includes(input.groupBy)) throw new CollectionError('invalid_request', 400);
  if (rows.length > 7936) throw new CollectionError('storage_unavailable', 503);
  const start = registry.events.find(event => event.name === definition.startEvent)!;
  const rules = Object.fromEntries(definition.dimensions.map(name => [name, start.properties[name]!])) as typeof start.properties;
  const values = new Map<string, { value: string | number | boolean; total: Counts; days: Map<string, Counts> }>();
  const totals = empty(); const hasFailure = definition.failureEvent !== null;
  for (const row of rows) {
    if (!dates.includes(row.cohort_date)) throw new CollectionError('storage_unavailable', 503);
    const properties = readDimensions(row.dimension_key, rules);
    const value = properties[input.groupBy];
    if (value === undefined) throw new CollectionError('storage_unavailable', 503);
    const counts = { started: count(row.started_count), succeeded: count(row.succeeded_count), failed: count(row.failed_count) };
    workflowCounts(counts.started, counts.succeeded, counts.failed, hasFailure);
    const key = JSON.stringify(value);
    const bucket = values.get(key) ?? { value, total: empty(), days: new Map<string, Counts>() };
    const day = bucket.days.get(row.cohort_date) ?? empty();
    for (const field of ['started', 'succeeded', 'failed'] as const) {
      day[field] = addCounts(day[field], counts[field]); bucket.total[field] = addCounts(bucket.total[field], counts[field]);
      totals[field] = addCounts(totals[field], counts[field]);
    }
    bucket.days.set(row.cohort_date, day); values.set(key, bucket);
  }
  if (values.size > 32) throw new CollectionError('storage_unavailable', 503);
  const summary = (value: Counts) => workflowCounts(value.started, value.succeeded, value.failed, hasFailure);
  // Date boundaries depend on the request, not on the dimension bucket.
  const dayStates = values.size ? dates.map(date => ({ date, provisional: now < dateEnd(date, meta.timeZone) + 2 * DAY })) : [];
  return { meta, workflowId: definition.id, cohortBasis: 'startedAt' as const, groupBy: input.groupBy, summary: summary(totals),
    buckets: [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => ({ value: bucket.value, summary: summary(bucket.total),
      days: dayStates.map(({ date, provisional }) => ({ date, ...summary(bucket.days.get(date) ?? empty()), provisional })) })) };
}
