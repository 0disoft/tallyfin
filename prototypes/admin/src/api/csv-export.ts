import { analyzeEventSeries } from './event-analysis.ts';
import { comparisonRows, countChange, rateChange, previousRange, validateSnapshot, type PeriodSnapshot } from './period-comparison.ts';
import type { EventSeriesResponse, QueryMeta, Registry, WorkflowSummary, WorkflowBreakdownResponse } from './types.ts';
import { validateWorkflowBreakdown } from './workflow-analysis.ts';
import { ContractError } from './validate.ts';

type Cell = string | number | boolean | null | undefined;
type Row = Partial<Record<typeof CSV_COLUMNS[number], Cell>>;
export type ExportView = 'overview' | 'events' | 'goals';
export type ExportInput = { registry: Registry; current: PeriodSnapshot; previous?: PeriodSnapshot;
  view: ExportView; filter?: string; selection?: { eventName: string; groupBy: string | null; series: EventSeriesResponse }; workflowSelections?: WorkflowBreakdownResponse[] };
export const CSV_COLUMNS = ['project_id', 'project_name', 'schema_version', 'time_zone', 'view', 'event_filter',
  'selected_event', 'selected_group_by', 'period', 'from', 'to', 'generated_at', 'coverage', 'source',
  'record_type', 'name', 'label', 'cohort_basis', 'date', 'group_by', 'value_type', 'value', 'count', 'share_percent',
  'started_attempts', 'succeeded_attempts', 'failed_attempts', 'pending_attempts', 'completion_rate_percent',
  'provisional', 'availability', 'previous_from', 'previous_to', 'previous_value', 'change', 'change_unit'] as const;

/** Quoted UTF-8 CSV for spreadsheet viewing. Protect text cells, never alter numeric negatives. */
export function csvCell(value: Cell): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ContractError('CSV 수치가 유효하지 않아요.');
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function serializeCsv(rows: readonly (readonly Cell[])[]): string {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function invalid(): never { throw new ContractError('현재 조회 조건과 CSV 데이터가 맞지 않아요. 다시 조회해 주세요.'); }

export function analyticsCsv(input: ExportInput): { filename: string; text: string; rowCount: number } {
  const { registry, current, previous, view, selection } = input;
  validateSnapshot(current, registry);
  if (previous) {
    validateSnapshot(previous, registry);
    const expected = previousRange(current.range);
    if (previous.range.from !== expected.from || previous.range.to !== expected.to) invalid();
  }
  if (selection && view !== 'events') invalid();
  const filter = view === 'events' ? input.filter?.trim() ?? '' : '';
  const rows: Row[] = [];
  const emit = (meta: QueryMeta, period: string, row: Row) => rows.push({
    project_id: registry.project.id, project_name: registry.project.name, schema_version: registry.schemaVersion,
    time_zone: meta.timeZone, view, event_filter: filter, selected_event: selection?.eventName,
    selected_group_by: selection?.groupBy, period, from: meta.from, to: meta.to, generated_at: meta.generatedAt,
    coverage: meta.coverage, source: meta.source, availability: 'available', ...row,
  });
  const workflowFields = (summary: WorkflowSummary): Row => ({ started_attempts: summary.startedAttempts,
    succeeded_attempts: summary.succeededAttempts, failed_attempts: summary.failedAttempts,
    pending_attempts: summary.pendingAttempts, completion_rate_percent: summary.completionRate });
  const addPeriod = (snapshot: PeriodSnapshot, period: string) => {
    emit(snapshot.summary.meta, period, { record_type: 'total', count: snapshot.summary.totalEvents });
    if (view !== 'goals') {
      const counts = new Map(snapshot.summary.events.map(event => [event.name, event.count]));
      for (const event of registry.events) {
        if (view === 'events' && !`${event.name} ${event.label}`.toLowerCase().includes(filter.toLowerCase())) continue;
        emit(snapshot.summary.meta, period, { record_type: 'event_total', name: event.name, label: event.label,
          source: event.source, count: event.source === 'browser' ? counts.get(event.name) : null,
          availability: event.source === 'server' ? 'unsupported' : 'available' });
      }
    }
    if (view !== 'events') {
      const flows = view === 'overview' ? snapshot.workflows.slice(0, 1) : snapshot.workflows;
      for (const flow of flows) {
        const base: Row = { name: flow.definition.id, label: flow.definition.label, cohort_basis: flow.response.cohortBasis };
        emit(flow.response.meta, period, { ...base, record_type: 'workflow_total', ...workflowFields(flow.response.summary),
          provisional: flow.response.days.some(day => day.provisional) });
        for (const day of flow.response.days) emit(flow.response.meta, period, { ...base, record_type: 'workflow_day',
          date: day.date, ...workflowFields(day), provisional: day.provisional });
      }
    }
  };
  addPeriod(current, 'current');
  if (previous) {
    addPeriod(previous, 'previous');
    for (const row of comparisonRows(current, previous, view)) {
      const change = row.rate ? rateChange(row.current, row.previous) : countChange(row.current, row.previous);
      emit(current.summary.meta, 'comparison', { record_type: 'comparison_metric', name: row.key, label: row.label,
        value: row.current, previous_from: previous.range.from, previous_to: previous.range.to, previous_value: row.previous,
        change, change_unit: row.rate ? 'percentage_point' : 'percent', availability: change === null ? 'not_available' : 'available' });
    }
  }
  if (selection) {
    const { series, eventName, groupBy } = selection;
    const event = registry.events.find(item => item.name === eventName && item.source === 'browser');
    if (!event || series.eventName !== eventName || series.groupBy !== groupBy || series.meta.projectId !== registry.project.id ||
      series.meta.schemaVersion !== registry.schemaVersion || series.meta.timeZone !== registry.project.timeZone ||
      series.meta.from !== current.range.from || series.meta.to !== current.range.to ||
      series.meta.source !== 'browser' || series.meta.coverage !== 'observed-only') invalid();
    const analysis = analyzeEventSeries(series, event);
    const base = { name: eventName, label: event.label, group_by: groupBy };
    emit(series.meta, 'current', { ...base, record_type: 'selected_event_total', count: series.totalEvents });
    for (const day of series.days) emit(series.meta, 'current', { ...base, record_type: 'event_day', date: day.date, count: day.count });
    for (const row of analysis?.rows ?? []) {
      const value = { value_type: row.value === null ? 'null' : typeof row.value, value: row.value };
      emit(series.meta, 'current', { ...base, ...value, record_type: 'property_total', count: row.count, share_percent: row.share });
      for (const day of row.daily) emit(series.meta, 'current', { ...base, ...value, record_type: 'property_day', date: day.date, count: day.count });
    }
  }
  if (input.workflowSelections?.length && view !== 'goals') invalid();
  const workflowsSeen = new Set<string>();
  for (const selection of input.workflowSelections ?? []) {
    if (workflowsSeen.has(selection.workflowId)) invalid(); workflowsSeen.add(selection.workflowId);
    validateWorkflowBreakdown(selection, registry, current.range, selection.workflowId, selection.groupBy);
    const label = registry.workflows.find(flow => flow.id === selection.workflowId)!.label;
    emit(selection.meta, 'current', { record_type: 'workflow_property_summary', name: selection.workflowId, label,
      cohort_basis: selection.cohortBasis, group_by: selection.groupBy, ...workflowFields(selection.summary) });
    for (const bucket of selection.buckets) {
      const base: Row = { name: selection.workflowId, label, cohort_basis: selection.cohortBasis, group_by: selection.groupBy,
        value_type: typeof bucket.value, value: bucket.value };
      emit(selection.meta, 'current', { ...base, record_type: 'workflow_property_total', ...workflowFields(bucket.summary), provisional: bucket.days.some(day => day.provisional) });
      for (const day of bucket.days) emit(selection.meta, 'current', { ...base, record_type: 'workflow_property_day', date: day.date,
        ...workflowFields(day), provisional: day.provisional });
    }
  }
  const safeId = registry.project.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return { filename: `tallyfin-${safeId}-v${registry.schemaVersion}-${view}-${current.range.from}-${current.range.to}.csv`,
    text: serializeCsv([CSV_COLUMNS, ...rows.map(row => CSV_COLUMNS.map(column => row[column]))]), rowCount: rows.length };
}
