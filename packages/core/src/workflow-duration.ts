import { CollectionError } from './types.ts';
import { integer } from './value.ts';
import { COLLECTION_POLICY } from './policy.ts';

/** Non-overlapping ranges in milliseconds; the last includes the 24h task-window endpoint. */
export const WORKFLOW_DURATION_RANGES = [
  { id: 'under_1s', upperMs: 1_000 }, { id: '1s_to_5s', upperMs: 5_000 },
  { id: '5s_to_30s', upperMs: 30_000 }, { id: '30s_to_2m', upperMs: 120_000 },
  { id: '2m_to_10m', upperMs: 600_000 }, { id: '10m_to_24h', upperMs: null },
] as const;
export const WORKFLOW_DURATION_SLOTS = WORKFLOW_DURATION_RANGES.length * 2;
export const emptyDurationCounts = (): number[] => Array(WORKFLOW_DURATION_SLOTS).fill(0);
export function workflowDurationSlot(elapsedMs: number, outcome: 'success' | 'failure'): number {
  if (!integer(elapsedMs, 0, COLLECTION_POLICY.taskWindowMs)) throw new CollectionError('storage_unavailable', 503);
  const bucket = WORKFLOW_DURATION_RANGES.findIndex(range => range.upperMs === null || elapsedMs < range.upperMs);
  return bucket * 2 + Number(outcome === 'failure');
}
export function workflowDuration(counts: readonly number[], succeeded: number, failed: number, hasFailure: boolean) {
  if (counts.length !== WORKFLOW_DURATION_SLOTS || counts.some(value => !integer(value, 0, Number.MAX_SAFE_INTEGER)))
    throw new CollectionError('storage_unavailable', 503);
  const measuredSuccess = counts.reduce((sum, value, index) => sum + (index % 2 === 0 ? value : 0), 0);
  const measuredFailure = counts.reduce((sum, value, index) => sum + (index % 2 === 1 ? value : 0), 0);
  if (!integer(succeeded, 0, Number.MAX_SAFE_INTEGER) || !integer(failed, 0, Number.MAX_SAFE_INTEGER) ||
    !Number.isSafeInteger(succeeded + failed) || measuredSuccess > succeeded || measuredFailure > failed ||
    (!hasFailure && failed !== 0))
    throw new CollectionError('storage_unavailable', 503);
  return { measuredAttempts: measuredSuccess + measuredFailure, unmeasuredAttempts: succeeded + failed - measuredSuccess - measuredFailure,
    buckets: WORKFLOW_DURATION_RANGES.map((range, index) => ({ range: range.id,
      succeededAttempts: counts[index * 2]!, failedAttempts: hasFailure ? counts[index * 2 + 1]! : null })) };
}
