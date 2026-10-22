import { CollectionError, emptyDurationCounts, WORKFLOW_DURATION_SLOTS } from '@tallyfin/core';

export const DURATION_SUM_SQL = Array.from({ length: WORKFLOW_DURATION_SLOTS }, (_, index) =>
  `SUM(json_extract(duration_counts_json, '$[${index}]')) AS duration_${index}`).join(', ');
export type DurationRow = Partial<Record<`duration_${number}`, number>>;
export function durationRowCounts(row: DurationRow | undefined): number[] {
  if (!row) return emptyDurationCounts();
  const counts = Array.from({ length: WORKFLOW_DURATION_SLOTS }, (_, index) => row[`duration_${index}`]);
  if (counts.some(value => !Number.isSafeInteger(value) || value! < 0)) throw new CollectionError('storage_unavailable', 503);
  return counts as number[];
}
