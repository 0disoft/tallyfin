import { CollectionError } from './types.ts';
import { dateMillis } from './query.ts';
import { DAY, integer, PROJECT_ID } from './value.ts';

export const REJECTION_REASONS = ['minute_limit', 'daily_limit', 'origin_denied', 'project_unavailable',
  'unknown_schema', 'invalid_request', 'invalid_event', 'event_conflict', 'attempt_conflict', 'storage_unavailable'] as const;
export type RejectionReason = typeof REJECTION_REASONS[number];
export const REJECTION_RETENTION_DAYS = 7;
export type RejectionCounts = Partial<Record<RejectionReason, { count: number; lastRejectedAt: number }>>;
export interface RejectionBucket { reason: RejectionReason; count: number; lastRejectedAt: string | null }
export interface RejectionSummary { rejectedRequests: number; lastRejectedAt: string | null; reasons: RejectionBucket[] }
export interface RejectionResponse {
  meta: { projectId: string; from: string; to: string; timeZone: 'UTC'; dateBasis: 'receivedAt';
    generatedAt: string; retentionDays: 7; coverage: 'best-effort' };
  summary: RejectionSummary;
  days: (RejectionSummary & { date: string })[];
}
export function rejectionRange(projectId: string, from: string, to: string, now: number): string[] {
  if (!PROJECT_ID.test(projectId) || !integer(now, 0, 8_640_000_000_000_000)) throw new CollectionError('invalid_request', 400);
  const start = dateMillis(from), end = dateMillis(to), today = Math.floor(now / DAY) * DAY;
  if (start > end || end > today || start < today - (REJECTION_RETENTION_DAYS - 1) * DAY)
    throw new CollectionError('invalid_request', 400);
  return Array.from({ length: (end - start) / DAY + 1 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
}
