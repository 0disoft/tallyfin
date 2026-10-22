import { CollectionError } from './types.ts';
import type { Registry, WorkflowDefinition } from './types.ts';
import { integer } from './value.ts';
import { SCHEMA_LIMITS } from './policy.ts';

export const MISSING_FAILURE_REASON_SLOT = SCHEMA_LIMITS.values;
export const FAILURE_REASON_SLOTS = MISSING_FAILURE_REASON_SLOT + 1;
export const emptyFailureReasonCounts = (): number[] => Array(FAILURE_REASON_SLOTS).fill(0);
export type FailureReasonDefinition = { property: string; values: string[] };
export function failureReasonDefinition(registry: Pick<Registry, 'events'>, workflow: WorkflowDefinition): FailureReasonDefinition | null {
  if (workflow.failureReasonProperty === undefined) return null;
  const event = registry.events.find(event => event.name === workflow.failureEvent && event.source === 'browser');
  const property = event?.properties[workflow.failureReasonProperty];
  if (!property || property.type !== 'enum') throw new CollectionError('storage_unavailable', 503);
  // Slots are version-scoped and independent of editable enum presentation order.
  return { property: workflow.failureReasonProperty, values: [...property.values].sort() };
}
export function failureReasonDistribution(definition: FailureReasonDefinition | null, counts: readonly number[], failed: number) {
  if (counts.length !== FAILURE_REASON_SLOTS || counts.some(value => !integer(value, 0, Number.MAX_SAFE_INTEGER)) ||
    !integer(failed, 0, Number.MAX_SAFE_INTEGER)) throw new CollectionError('storage_unavailable', 503);
  const measuredFailures = counts.reduce((sum, count) => sum + count, 0);
  if (measuredFailures > failed || (!definition && measuredFailures > 0) ||
    (definition && counts.slice(definition.values.length, MISSING_FAILURE_REASON_SLOT).some(value => value !== 0)))
    throw new CollectionError('storage_unavailable', 503);
  if (!definition) return null;
  return { property: definition.property, measuredFailures, missingReasonFailures: counts[MISSING_FAILURE_REASON_SLOT]!,
    unmeasuredFailures: failed - measuredFailures,
    buckets: definition.values.map((value, index) => ({ value, failedAttempts: counts[index]! })) };
}
