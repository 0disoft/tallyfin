import { parseFunnelResponse, type FunnelResponse } from './funnel-contract.ts';
import { serializeCsv } from './csv-export.ts';
import { compareFunnels } from './funnel-comparison.ts';

export const FUNNEL_CSV_COLUMNS = ['project_id', 'schema_version', 'time_zone', 'from', 'to', 'generated_at', 'latest_received_at',
  'coverage', 'funnel_id', 'funnel_label', 'cohort_basis', 'row_type', 'date', 'step_index', 'event_name', 'source',
  'reached_runs', 'reach_rate_percent', 'conversion_rate_percent', 'not_reached_next', 'started_runs', 'completed_runs',
  'completion_rate_percent', 'provisional'] as const;
export function funnelCsv(response: FunnelResponse, previous?: FunnelResponse): string {
  const data = parseFunnelResponse(response);
  const comparison = previous ? compareFunnels(data, previous) : null;
  const columns = comparison ? [...FUNNEL_CSV_COLUMNS, 'period', 'metric', 'current_value', 'previous_value', 'change', 'change_unit'] : [...FUNNEL_CSV_COLUMNS];
  const rows: (string | number | boolean | null)[][] = [columns];
  const append = (data: FunnelResponse, counts: typeof data.summary, type: string, date: string | null, provisional: boolean, period: string) => {
    const { meta, definition: def } = data;
    for (const step of counts.steps) rows.push([meta.projectId, meta.schemaVersion, meta.timeZone, meta.from, meta.to,
      meta.generatedAt, meta.latestReceivedAt, meta.coverage, data.funnelId, def.label, data.cohortBasis, type, date,
      step.stepIndex, def.steps[step.stepIndex]!.eventName, def.steps[step.stepIndex]!.source, step.reachedRuns,
      step.reachRate, step.conversionRate, step.notReachedNext, counts.startedRuns, counts.completedRuns, counts.completionRate, provisional,
      ...(comparison ? [period, null, null, null, null, null] : [])]);
  };
  const period = (response: FunnelResponse, name: string) => {
    append(response, response.summary, 'summary', null, response.days.some(day => day.provisional), name);
    response.days.forEach(day => append(response, day, 'daily', day.date, day.provisional, name));
  };
  period(data, 'current');
  if (previous && comparison) {
    period(parseFunnelResponse(previous), 'previous');
    for (const row of comparison) {
      const record: (string | number | boolean | null)[] = Array(columns.length).fill(null);
      const set = (column: string, value: string | number | boolean | null) => { record[columns.indexOf(column)] = value; };
      for (const [key, value] of Object.entries({ project_id: data.meta.projectId, schema_version: data.meta.schemaVersion,
        time_zone: data.meta.timeZone, from: data.meta.from, to: data.meta.to, generated_at: data.meta.generatedAt,
        latest_received_at: data.meta.latestReceivedAt, coverage: data.meta.coverage, funnel_id: data.funnelId,
        funnel_label: data.definition.label, cohort_basis: data.cohortBasis, row_type: 'comparison', period: 'current-vs-previous',
        metric: row.key, current_value: row.current, previous_value: row.previous, change: row.change, change_unit: row.unit,
        step_index: row.stepIndex, provisional: [data, previous].some(report => report.days.some(day => day.provisional)) })) set(key, value);
      if (row.stepIndex !== null) {
        const step = data.definition.steps[row.stepIndex]!;
        set('event_name', step.eventName); set('source', step.source);
      }
      rows.push(record);
    }
  }
  return serializeCsv(rows);
}
export function funnelCsvFilename(response: FunnelResponse): string {
  const data = parseFunnelResponse(response);
  return `tallyfin-${data.meta.projectId}-v${data.meta.schemaVersion}-${data.funnelId}-${data.meta.from}-${data.meta.to}-funnel.csv`;
}
