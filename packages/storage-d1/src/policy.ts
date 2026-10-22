import { QUERY_POLICY, SCHEMA_LIMITS } from '@tallyfin/core';
/** Adapter limits, independent of HTTP page sizes or SDK retry counts. */
export const D1_POLICY = { maxBindings: 100, snapshotAttempts: 3, cleanupRows: 500, maxCleanupRows: 1000 } as const;
export const ANALYTICS_ROW_LIMITS = {
  summary: SCHEMA_LIMITS.events, days: QUERY_POLICY.maxDays,
  dailyDimensions: QUERY_POLICY.maxDays * SCHEMA_LIMITS.combinations,
  funnelSteps: QUERY_POLICY.maxDays * SCHEMA_LIMITS.maxSteps,
} as const;
