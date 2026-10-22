import { ContractError } from './validate.ts';
import type { Registry, WorkflowDefinition, WorkflowResponse, WorkflowSummary } from './types.ts';

export type FailureReasons = { property: string; measuredFailures: number; missingReasonFailures: number; unmeasuredFailures: number;
  buckets: { value: string; failedAttempts: number }[] };
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const VALUE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
function invalid(): never { throw new ContractError('실패 원인의 정의·건수·측정 범위가 맞지 않아요.'); }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value; }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
export function parseFailureReasons(value: unknown, summary: WorkflowSummary): FailureReasons | null {
  if (value === null) return null;
  if (summary.failedAttempts === null) invalid();
  const row = object(value, ['property', 'measuredFailures', 'missingReasonFailures', 'unmeasuredFailures', 'buckets']);
  if (typeof row.property !== 'string' || !NAME.test(row.property) || !Array.isArray(row.buckets) || row.buckets.length < 1 || row.buckets.length > 32) invalid();
  const buckets = row.buckets.map(value => {
    const bucket = object(value, ['value', 'failedAttempts']);
    if (typeof bucket.value !== 'string' || !VALUE.test(bucket.value)) invalid();
    return { value: bucket.value, failedAttempts: count(bucket.failedAttempts) };
  });
  if (buckets.some((bucket, index) => index > 0 && buckets[index - 1]!.value >= bucket.value)) invalid();
  const measuredFailures = count(row.measuredFailures), missingReasonFailures = count(row.missingReasonFailures), unmeasuredFailures = count(row.unmeasuredFailures);
  if (buckets.reduce((sum, bucket) => count(sum + bucket.failedAttempts), missingReasonFailures) !== measuredFailures ||
    count(measuredFailures + unmeasuredFailures) !== count(summary.failedAttempts)) invalid();
  return { property: row.property, measuredFailures, missingReasonFailures, unmeasuredFailures, buckets };
}
export function validateFailureReasons(response: Pick<WorkflowResponse, 'failureReasons' | 'days' | 'summary'>): void {
  const total = response.failureReasons;
  if (total === undefined || total === null) { if (response.days.some(day => day.failureReasons !== total)) invalid(); return; }
  const parsed = parseFailureReasons(total, response.summary)!;
  const days = response.days.map(day => { const value = parseFailureReasons(day.failureReasons, day); if (!value) invalid(); return value; });
  for (const key of ['measuredFailures', 'missingReasonFailures', 'unmeasuredFailures'] as const)
    if (days.reduce((sum, day) => count(sum + day[key]), 0) !== parsed[key]) invalid();
  if (days.some(day => day.property !== parsed.property || day.buckets.length !== parsed.buckets.length ||
    day.buckets.some((bucket, index) => bucket.value !== parsed.buckets[index]!.value))) invalid();
  parsed.buckets.forEach((bucket, index) => {
    if (days.reduce((sum, day) => count(sum + day.buckets[index]!.failedAttempts), 0) !== bucket.failedAttempts) invalid();
  });
}
export function validateFailureReasonDefinition(response: WorkflowResponse, definition: WorkflowDefinition, registry: Registry): void {
  validateFailureReasons(response);
  const registered = registry.workflows.find(w => w.id === definition.id);
  const configured = definition.failureReasonProperty;
  if (!registered || configured !== registered.failureReasonProperty || definition.failureEvent !== registered.failureEvent) invalid();
  if (configured !== undefined) {
    const event = registry.events.find(e => e.name === definition.failureEvent && e.source === 'browser');
    const property = event?.properties[configured];
    if (!NAME.test(configured) || !property || property.type !== 'enum') invalid();
    const values = [...property.values].sort();
    if (response.failureReasons === null || (response.failureReasons !== undefined &&
      (response.failureReasons.property !== configured || response.failureReasons.buckets.length !== values.length ||
        response.failureReasons.buckets.some((bucket, index) => bucket.value !== values[index])))) invalid();
  } else if (response.failureReasons !== undefined && response.failureReasons !== null) invalid();
}
export function failureReasonAvailability(value: FailureReasons | null | undefined): 'unavailable' | 'not_configured' | 'partial' | 'complete' | 'unmeasured' | 'no_failed_attempts' {
  if (value === undefined) return 'unavailable';
  if (value === null) return 'not_configured';
  if (value.measuredFailures) return value.unmeasuredFailures ? 'partial' : 'complete';
  return value.unmeasuredFailures ? 'unmeasured' : 'no_failed_attempts';
}
