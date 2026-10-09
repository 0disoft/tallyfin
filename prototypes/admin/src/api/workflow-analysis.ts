import { assertMeta, validateWorkflowLoad, validateWorkflowSummary, type DateRange } from './period-comparison.ts';
import type { Registry, WorkflowBreakdownResponse } from './types.ts';
import { ContractError } from './validate.ts';

export type WorkflowGroupingState = { context: string; groupBy: string; status: 'idle' | 'loading' | 'ready' | 'error'; data?: WorkflowBreakdownResponse };
function invalid(): never { throw new ContractError('흐름 속성별 응답의 값·날짜·합계가 정의와 맞지 않아요.'); }
export function validateWorkflowBreakdown(response: WorkflowBreakdownResponse, registry: Registry, range: DateRange, workflowId: string, groupBy: string): void {
  const definition = registry.workflows.find(flow => flow.id === workflowId);
  if (!definition || !definition.dimensions.includes(groupBy) || response.workflowId !== workflowId || response.groupBy !== groupBy || response.cohortBasis !== 'startedAt') invalid();
  assertMeta(response.meta, registry, range); validateWorkflowSummary(response.summary, definition);
  const rule = registry.events.find(event => event.name === definition.startEvent)?.properties[groupBy];
  if (!rule || !rule.required || response.buckets.length > 32) invalid();
  const seen = new Set<string>(), totals = { startedAttempts: 0, succeededAttempts: 0, failedAttempts: 0, pendingAttempts: 0 };
  for (const bucket of response.buckets) {
    const value = bucket.value, key = JSON.stringify(value);
    if (seen.has(key) || !(rule.type === 'boolean' ? typeof value === 'boolean' : rule.type === 'enum' ? typeof value === 'string' && rule.values.includes(value)
      : typeof value === 'number' && Number.isSafeInteger(value) && value >= rule.minimum && value <= rule.maximum)) invalid();
    seen.add(key);
    validateWorkflowLoad({ definition, response: { meta: response.meta, workflowId, cohortBasis: response.cohortBasis, ...bucket } }, registry, range);
    for (const field of ['startedAttempts', 'succeededAttempts', 'failedAttempts', 'pendingAttempts'] as const) {
      totals[field] += bucket.summary[field] ?? 0;
      if (!Number.isSafeInteger(totals[field])) invalid();
    }
  }
  for (const field of ['startedAttempts', 'succeededAttempts', 'failedAttempts', 'pendingAttempts'] as const)
    if (totals[field] !== (response.summary[field] ?? 0)) invalid();
}
export function workflowValueLabel(value: string | number | boolean): string {
  return typeof value === 'boolean' ? value ? '참 (true)' : '거짓 (false)' : String(value);
}
