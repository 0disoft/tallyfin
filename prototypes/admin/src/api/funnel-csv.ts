import { parseFunnelResponse, type FunnelResponse } from './funnel-contract.ts';
import { serializeCsv } from './csv-export.ts';

export const FUNNEL_CSV_COLUMNS = ['project_id', 'schema_version', 'time_zone', 'from', 'to', 'generated_at', 'latest_received_at',
  'coverage', 'funnel_id', 'funnel_label', 'cohort_basis', 'row_type', 'date', 'step_index', 'event_name', 'source',
  'reached_runs', 'reach_rate_percent', 'conversion_rate_percent', 'not_reached_next', 'started_runs', 'completed_runs',
  'completion_rate_percent', 'provisional'] as const;
export function funnelCsv(response: FunnelResponse): string {
  const data = parseFunnelResponse(response), { meta, definition: def } = data;
  const rows: (string | number | boolean | null)[][] = [[...FUNNEL_CSV_COLUMNS]];
  const append = (counts: typeof data.summary, type: string, date: string | null, provisional: boolean) => {
    for (const step of counts.steps) rows.push([meta.projectId, meta.schemaVersion, meta.timeZone, meta.from, meta.to,
      meta.generatedAt, meta.latestReceivedAt, meta.coverage, data.funnelId, def.label, data.cohortBasis, type, date,
      step.stepIndex, def.steps[step.stepIndex]!.eventName, def.steps[step.stepIndex]!.source, step.reachedRuns,
      step.reachRate, step.conversionRate, step.notReachedNext, counts.startedRuns, counts.completedRuns, counts.completionRate, provisional]);
  };
  append(data.summary, 'summary', null, data.days.some(day => day.provisional));
  data.days.forEach(day => append(day, 'daily', day.date, day.provisional));
  return serializeCsv(rows);
}
export function funnelCsvFilename(response: FunnelResponse): string {
  const data = parseFunnelResponse(response);
  return `tallyfin-${data.meta.projectId}-v${data.meta.schemaVersion}-${data.funnelId}-${data.meta.from}-${data.meta.to}-funnel.csv`;
}
