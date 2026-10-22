import { CollectionError, emptyFailureReasonCounts, FAILURE_REASON_SLOTS } from '@tallyfin/core';

export const FAILURE_REASON_SUM_SQL = Array.from({ length: FAILURE_REASON_SLOTS }, (_, index) =>
  `SUM(json_extract(failure_reason_counts_json, '$[${index}]')) AS failure_reason_${index}`).join(', ');
export type FailureReasonRow = Partial<Record<`failure_reason_${number}`, number>>;
export function failureReasonRowCounts(row: FailureReasonRow | undefined): number[] {
  if (!row) return emptyFailureReasonCounts();
  const counts = Array.from({ length: FAILURE_REASON_SLOTS }, (_, index) => row[`failure_reason_${index}`]);
  if (counts.some(value => !Number.isSafeInteger(value) || value! < 0)) throw new CollectionError('storage_unavailable', 503);
  return counts as number[];
}
