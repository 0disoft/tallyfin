import { ApiError } from './client.ts';
import { toApiError } from './load-state.ts';
import type { ApiClient } from './client.ts';
import { shiftDate } from './dates.ts';
import type { EventSource, QueryMeta, Registry, SummaryResponse, WorkflowDefinition, WorkflowResponse, WorkflowSummary } from './types.ts';
import { ContractError } from './validate.ts';
import { validateWorkflowDurations } from './workflow-duration.ts';

export type DateRange = { from: string; to: string };
export type WorkflowLoad = { definition: WorkflowDefinition; response: WorkflowResponse };
export type AnalysisView = 'overview' | 'events' | 'goals';
export type WorkflowFailure = { definition: WorkflowDefinition; error: ApiError };
export type PeriodSnapshot = { summary: SummaryResponse; workflows: WorkflowLoad[]; range: DateRange; view?: AnalysisView; workflowErrors?: WorkflowFailure[] };

export function periodWorkflows(registry: Registry, source: EventSource, view: AnalysisView = 'goals'): WorkflowDefinition[] {
  if (source !== 'browser' || view === 'events') return [];
  return view === 'overview' ? registry.workflows.filter(w => w.id === registry.representativeWorkflowId) : registry.workflows;
}
export type ComparisonRow = { key: string; label: string; current: number | null; previous: number | null; rate?: boolean };
export function comparisonRows(current: PeriodSnapshot, previous: PeriodSnapshot, view: string): ComparisonRow[] {
  if (current.summary.meta.source !== previous.summary.meta.source) invalid();
  const rows: ComparisonRow[] = [{ key: 'total', label: '수집 이벤트', current: current.summary.totalEvents, previous: previous.summary.totalEvents }];
  if (view === 'events') {
    const before = new Map(previous.summary.events.map(event => [event.name, event.count]));
    rows.push(...current.summary.events.map(event => ({ key: `event:${event.name}`, label: event.name, current: event.count, previous: before.get(event.name) ?? null })));
  } else {
    // Overview snapshots already contain only the explicitly selected workflow.
    for (const flow of current.workflows) {
      const before = previous.workflows.find(item => item.definition.id === flow.definition.id)?.response.summary;
      for (const [key, label, rate] of [['startedAttempts', '시작', false], ['succeededAttempts', '성공', false], ['completionRate', '완료율', true]] as const)
        rows.push({ key: `${flow.definition.id}:${key}`, label: `${flow.definition.label} · ${label}`, current: flow.response.summary[key], previous: before?.[key] ?? null, rate });
    }
  }
  return rows;
}

function invalid(): never { throw new ContractError('기간 비교 응답의 날짜·정의·합계가 요청과 맞지 않아요.'); }
function count(value: number): number { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; }
function days(range: DateRange): number {
  const length = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000 + 1;
  if (!Number.isInteger(length) || length < 1 || length > 31) invalid();
  return length;
}
export function previousRange(range: DateRange): DateRange {
  return { from: shiftDate(range.from, -days(range)), to: shiftDate(range.from, -1) };
}
export function countChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (count(current) - count(previous)) / previous * 100;
}
export function rateChange(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}
export function assertMeta(meta: QueryMeta, registry: Registry, range: DateRange, source: EventSource = 'browser') {
  if (meta.projectId !== registry.project.id || meta.schemaVersion !== registry.schemaVersion ||
    meta.timeZone !== registry.project.timeZone || meta.from !== range.from || meta.to !== range.to ||
    !['browser', 'server'].includes(source) || meta.source !== source || meta.coverage !== 'observed-only') invalid();
}
export function validateWorkflowSummary(value: WorkflowSummary, definition: WorkflowDefinition): void {
  const start = count(value.startedAttempts), success = count(value.succeededAttempts), pending = count(value.pendingAttempts);
  if ((value.failedAttempts === null) !== (definition.failureEvent === null)) invalid();
  const failed = value.failedAttempts === null ? 0 : count(value.failedAttempts);
  if (count(success + failed + pending) !== start) invalid();
  const rate = start === 0 ? null : success / start * 100;
  if ((rate === null) !== (value.completionRate === null) ||
    (rate !== null && (value.completionRate === null || !Number.isFinite(value.completionRate) || Math.abs(rate - value.completionRate) > 0.000001))) invalid();
}
export function validateWorkflowLoad({ definition, response }: WorkflowLoad, registry: Registry, range: DateRange): void {
  validateWorkflowDurations(response);
  if (!registry.workflows.some(item => item.id === definition.id) || response.workflowId !== definition.id || response.cohortBasis !== 'startedAt') invalid();
  assertMeta(response.meta, registry, range); validateWorkflowSummary(response.summary, definition);
  if (response.days.length !== days(range)) invalid();
  const totals = { startedAttempts: 0, succeededAttempts: 0, pendingAttempts: 0, failedAttempts: 0 };
  response.days.forEach((day, index) => {
    if (day.date !== shiftDate(range.from, index) || typeof day.provisional !== 'boolean') invalid();
    validateWorkflowSummary(day, definition);
    for (const key of ['startedAttempts', 'succeededAttempts', 'pendingAttempts', 'failedAttempts'] as const)
      totals[key] = count(totals[key] + (day[key] ?? 0));
  });
  for (const key of ['startedAttempts', 'succeededAttempts', 'pendingAttempts', 'failedAttempts'] as const)
    if (totals[key] !== (response.summary[key] ?? 0)) invalid();
}
export function validateSnapshot(snapshot: PeriodSnapshot, registry: Registry, source: EventSource = 'browser', allowPartial = false): void {
  const { summary, workflows, range } = snapshot;
  assertMeta(summary.meta, registry, range, source);
  days(range);
  const expected = registry.events.filter(event => event.source === source).map(event => event.name);
  if (summary.events.length !== expected.length || new Set(summary.events.map(event => event.name)).size !== expected.length ||
    summary.events.some(event => !expected.includes(event.name)) ||
    summary.events.reduce((total, event) => count(total + count(event.count)), 0) !== count(summary.totalEvents)) invalid();
  if (snapshot.view !== undefined && !['overview', 'events', 'goals'].includes(snapshot.view)) invalid();
  const failures = snapshot.workflowErrors ?? [];
  if (failures.length && (!allowPartial || snapshot.view !== 'goals')) invalid();
  const allFlows = periodWorkflows(registry, source, snapshot.view);
  const failedIds = new Set(failures.map(failure => failure.definition.id));
  if (failedIds.size !== failures.length || failures.some(failure => !allFlows.some(flow => flow.id === failure.definition.id))) invalid();
  const expectedFlows = allFlows.filter(flow => !failedIds.has(flow.id));
  if (workflows.length !== expectedFlows.length || workflows.some((load, index) => load.definition.id !== expectedFlows[index]!.id)) invalid();
  for (const workflow of workflows) validateWorkflowLoad(workflow, registry, range);
}
/** Separate requests keep each window within the API's 31-day limit. */
export async function loadPeriod(client: ApiClient, registry: Registry, range: DateRange, signal: AbortSignal, source: EventSource = 'browser', view?: AnalysisView): Promise<PeriodSnapshot> {
  const options = { schemaVersion: registry.schemaVersion, ...range, signal };
  const [summary, results] = await Promise.all([
    client.getSummary(registry.project.id, { ...options, source }),
    Promise.all(periodWorkflows(registry, source, view).map(async definition => {
      try {
        const load = { definition, response: await client.getWorkflowDaily(registry.project.id, definition.id, options) };
        validateWorkflowLoad(load, registry, range);
        return { load };
      } catch (error) {
        signal.throwIfAborted();
        if (view !== 'goals' || (error instanceof ApiError && ['unauthorized', 'forbidden'].includes(error.kind))) throw error;
        return { failure: { definition, error: toApiError(error) } };
      }
    })),
  ]);
  const workflows = results.flatMap(result => result.load ? [result.load] : []);
  const workflowErrors = results.flatMap(result => result.failure ? [result.failure] : []);
  const snapshot = { summary, workflows, range, ...(view ? { view } : {}), ...(workflowErrors.length ? { workflowErrors } : {}) };
  validateSnapshot(snapshot, registry, source, view === 'goals');
  return snapshot;
}

/** Replace one recovered panel, preserving registry order and all other failures. */
export function recoverWorkflow(snapshot: PeriodSnapshot, registry: Registry, load: WorkflowLoad): PeriodSnapshot {
  validateWorkflowLoad(load, registry, snapshot.range);
  const loaded = new Map(snapshot.workflows.map(item => [item.definition.id, item]));
  loaded.set(load.definition.id, load);
  const next = { ...snapshot, workflows: periodWorkflows(registry, snapshot.summary.meta.source, snapshot.view).flatMap(definition => {
    const value = loaded.get(definition.id); return value ? [value] : [];
  }), workflowErrors: snapshot.workflowErrors?.filter(failure => failure.definition.id !== load.definition.id) };
  validateSnapshot(next, registry, snapshot.summary.meta.source, true);
  return next;
}
