import type { ErrorCode } from '@tallyfin/core';
import type { LatencyBucket, RequestOperation } from '../../apps/collector/src/request-observation.ts';

// Shared by the local log aggregator and browser report reader; no I/O or Node runtime dependency.
export const SUMMARY_LIMITS = { bytes: 8 * 1024 * 1024, lines: 50000, lineBytes: 16384 } as const;
export const OPERATIONS = ['browser_collection', 'server_collection', 'administrator', 'other'] as const satisfies readonly RequestOperation[];
export const BUCKETS = ['lt_10ms', 'lt_50ms', 'lt_250ms', 'lt_1000ms', 'gte_1000ms', 'unknown'] as const satisfies readonly LatencyBucket[];
export const CODES: Record<ErrorCode | 'ok', true> = {
  ok: true, invalid_request: true, invalid_event: true, unknown_schema: true, origin_denied: true,
  project_unavailable: true, event_conflict: true, attempt_conflict: true, quota_exceeded: true,
  unauthorized: true, forbidden: true, not_found: true, storage_unavailable: true, settings_conflict: true,
  schema_conflict: true, schema_draft_conflict: true, project_conflict: true, project_limit_reached: true, grant_conflict: true,
  last_owner: true, publisher_conflict: true,
};
