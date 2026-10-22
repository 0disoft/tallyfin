import { DAY } from './value.ts';

export const COLLECTION_POLICY = {
  maxBatchEvents: 20, maxEventAgeMs: DAY, maxFutureSkewMs: 300_000, taskWindowMs: DAY,
  receiptTtlMs: 2 * DAY, linkageTtlMs: 3 * DAY,
  maxRequestsPerMinute: 600, maxNewReceiptsPerUtcDay: 1_000_000,
} as const;
export const SCHEMA_LIMITS = {
  events: 50, workflows: 10, funnels: 10, minSteps: 2, maxSteps: 10,
  properties: 4, dimensions: 4, values: 32, combinations: 256, maxVersion: 2_147_483_647,
} as const;
export const RETENTION_POLICY = {
  analyticsDays: 90, rejectionDays: 7, dailyUsageDays: 4, idleMinuteGraceMs: 120_000,
} as const;
export const QUERY_POLICY = { maxDays: 31, defaultPageSize: 25, maxPageSize: 100,
  maxQueryChars: 512, maxIdentityCursorQueryChars: 12352 } as const;
