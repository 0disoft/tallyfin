import { previousRange, validateWorkflowLoad } from './period-comparison.ts';
import type { WorkflowLoad } from './period-comparison.ts';
import type { Registry, WorkflowResponse } from './types.ts';
import { ContractError } from './validate.ts';
import { failureReasonAvailability } from './workflow-failure-reasons.ts';
import type { FailureReasons } from './workflow-failure-reasons.ts';

export type ReasonComparisonStatus = 'comparable' | 'not_configured' | 'unavailable' | 'incomplete_measurement' | 'no_failed_attempts';
export type ReasonComparisonRow = { kind: 'enum' | 'missing' | 'unmeasured'; value: string;
  currentCount: number | null; previousCount: number | null; currentShare: number | null; previousShare: number | null; shareChange: number | null };
const difference = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const share = (count: number | null, total: number | null) => count === null || !total ? null : count / total * 100;
function reasonCount(value: FailureReasons | null | undefined, failed: number | null, kind: ReasonComparisonRow['kind'], index: number): number | null {
  if (!value) return null;
  if (kind === 'unmeasured') return value.unmeasuredFailures;
  if (value.measuredFailures === 0 && failed !== 0) return null;
  return kind === 'missing' ? value.missingReasonFailures : value.buckets[index]!.failedAttempts;
}
export function compareFailureReasons(current: WorkflowLoad, previous: WorkflowLoad, registry: Registry) {
  const range = { from: current.response.meta.from, to: current.response.meta.to }, priorRange = previousRange(range);
  validateWorkflowLoad(current, registry, range); validateWorkflowLoad(previous, registry, priorRange);
  if (current.definition.id !== previous.definition.id) throw new ContractError('비교할 작업 흐름이 달라요.');
  const now = current.response, before = previous.response, a = now.failureReasons, b = before.failureReasons;
  const status: ReasonComparisonStatus = !current.definition.failureReasonProperty ? 'not_configured'
    : !a || !b ? 'unavailable' : a.unmeasuredFailures || b.unmeasuredFailures ? 'incomplete_measurement'
    : !now.summary.failedAttempts || !before.summary.failedAttempts ? 'no_failed_attempts' : 'comparable';
  const property = registry.events.find(e => e.source === 'browser' && e.name === current.definition.failureEvent)
    ?.properties[current.definition.failureReasonProperty ?? ''];
  const values = property?.type === 'enum' ? [...property.values].sort() : [];
  const descriptors: { kind: ReasonComparisonRow['kind']; value: string }[] = values.length ? [
    ...values.map(value => ({ kind: 'enum' as const, value })), { kind: 'missing', value: '' }, { kind: 'unmeasured', value: '' },
  ] : [];
  const rows: ReasonComparisonRow[] = descriptors.map(({ kind, value }, index) => {
    const currentCount = reasonCount(a, now.summary.failedAttempts, kind, index), previousCount = reasonCount(b, before.summary.failedAttempts, kind, index);
    const currentShare = share(currentCount, now.summary.failedAttempts), previousShare = share(previousCount, before.summary.failedAttempts);
    return { kind, value, currentCount, previousCount, currentShare, previousShare,
      shareChange: status === 'comparable' ? difference(currentShare, previousShare) : null };
  });
  const rate = (response: WorkflowResponse) => share(response.summary.failedAttempts, response.summary.startedAttempts);
  const currentFailureRate = rate(now), previousFailureRate = rate(before);
  return { rows, status, currentFailureRate, previousFailureRate, failureRateChange: difference(currentFailureRate, previousFailureRate),
    currentSummary: now.summary, previousSummary: before.summary,
    currentCoverage: failureReasonAvailability(a), previousCoverage: failureReasonAvailability(b),
    provisional: [...now.days, ...before.days].some(day => day.provisional), range, previousRange: priorRange };
}
export type FailureReasonComparison = ReturnType<typeof compareFailureReasons>;
