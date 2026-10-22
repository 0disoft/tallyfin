export interface CleanupMetrics { deletedRows: number; saturatedTables: number; oldestExpiredReceiptAgeMs: number | null; measuredProjects: number; capacityLimitedProjects: number }
const keys = ['deletedRows', 'saturatedTables', 'oldestExpiredReceiptAgeMs', 'measuredProjects', 'capacityLimitedProjects'];
export function validCleanupMetrics(value: unknown, completed: number): value is CleanupMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return false;
  for (const key of keys.filter(key => key !== 'oldestExpiredReceiptAgeMs'))
    if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0) return false;
  const measured = Number(row.measuredProjects);
  return measured > 0 && measured <= completed && Number(row.deletedRows) <= measured * 9 * 10000 &&
    Number(row.saturatedTables) <= measured * 9 && Number(row.capacityLimitedProjects) <= measured &&
    (row.oldestExpiredReceiptAgeMs === null || (Number.isSafeInteger(row.oldestExpiredReceiptAgeMs) && Number(row.oldestExpiredReceiptAgeMs) >= 0 && Number(row.oldestExpiredReceiptAgeMs) <= 8640000000000000));
}
// Retain acceptance of logs from the former five-project/four-page worker.
export const CLEANUP_LOG_PROJECT_LIMIT = 20;
