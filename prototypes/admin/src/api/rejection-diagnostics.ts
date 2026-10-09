import { shiftDate } from './dates.ts';
import { ContractError } from './validate.ts';

export const REJECTION_LABELS = {
  minute_limit: '분당 요청 한도', daily_limit: '일일 신규 수신 한도', origin_denied: '허용 출처 불일치',
  project_unavailable: '프로젝트 일시정지', unknown_schema: '사용할 수 없는 스키마', invalid_request: '요청 형식 오류',
  invalid_event: '이벤트 형식 오류', event_conflict: '이벤트 ID 충돌', attempt_conflict: '작업 시도 충돌', storage_unavailable: '저장소 오류',
} as const;
export type RejectionReason = keyof typeof REJECTION_LABELS;
export type RejectionBucket = { reason: RejectionReason; count: number; lastRejectedAt: string | null };
export type RejectionSummary = { rejectedRequests: number; lastRejectedAt: string | null; reasons: RejectionBucket[] };
export type RejectionResponse = {
  meta: { projectId: string; from: string; to: string; timeZone: 'UTC'; dateBasis: 'receivedAt'; generatedAt: string;
    retentionDays: 7; coverage: 'best-effort' };
  summary: RejectionSummary;
  days: (RejectionSummary & { date: string })[];
};

function invalid(): never { throw new ContractError('Collection rejection response is inconsistent', 'response'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) invalid();
  return result;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) invalid();
  return new Date(value).toISOString();
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  timestamp(`${value}T00:00:00.000Z`);
  return value;
}
function latest(values: (string | null)[]): string | null {
  return values.reduce<string | null>((a, b) => b !== null && (a === null || b > a) ? b : a, null);
}
function summary(value: unknown, day?: string): RejectionSummary {
  const row = record(value, ['rejectedRequests', 'lastRejectedAt', 'reasons', ...(day === undefined ? [] : ['date'])]);
  const total = count(row.rejectedRequests);
  const last = row.lastRejectedAt === null ? null : timestamp(row.lastRejectedAt);
  const codes = Object.keys(REJECTION_LABELS) as RejectionReason[];
  if (!Array.isArray(row.reasons) || row.reasons.length !== codes.length) invalid();
  const reasons = row.reasons.map(value => {
    const bucket = record(value, ['reason', 'count', 'lastRejectedAt']);
    if (typeof bucket.reason !== 'string' || !Object.hasOwn(REJECTION_LABELS, bucket.reason)) invalid();
    const n = count(bucket.count), at = bucket.lastRejectedAt === null ? null : timestamp(bucket.lastRejectedAt);
    if ((n === 0) !== (at === null) || (day !== undefined && at !== null && at.slice(0, 10) !== day)) invalid();
    return { reason: bucket.reason as RejectionReason, count: n, lastRejectedAt: at };
  });
  if (new Set(reasons.map(row => row.reason)).size !== codes.length ||
    reasons.reduce((sum, row) => sum + row.count, 0) !== total || latest(reasons.map(row => row.lastRejectedAt)) !== last) invalid();
  return { rejectedRequests: total, lastRejectedAt: last, reasons };
}

/** Closed API contract; malformed or partial diagnostics must never become zero. */
export function parseRejectionResponse(value: unknown): RejectionResponse {
  const root = record(value, ['meta', 'summary', 'days']);
  const meta = record(root.meta, ['projectId', 'from', 'to', 'timeZone', 'dateBasis', 'generatedAt', 'retentionDays', 'coverage']);
  if (typeof meta.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(meta.projectId) || meta.timeZone !== 'UTC' ||
    meta.dateBasis !== 'receivedAt' || meta.retentionDays !== 7 || meta.coverage !== 'best-effort') invalid();
  const from = date(meta.from), to = date(meta.to), generatedAt = timestamp(meta.generatedAt);
  const length = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (length < 1 || length > 7 || !Array.isArray(root.days) || root.days.length !== length) invalid();
  const days = root.days.map((value, index) => {
    const expected = shiftDate(from, index), row = record(value, ['date', 'rejectedRequests', 'lastRejectedAt', 'reasons']);
    if (row.date !== expected) invalid();
    return { date: expected, ...summary(row, expected) };
  });
  const total = summary(root.summary);
  if (days.reduce((sum, row) => sum + row.rejectedRequests, 0) !== total.rejectedRequests ||
    latest(days.map(row => row.lastRejectedAt)) !== total.lastRejectedAt) invalid();
  for (const bucket of total.reasons) {
    const values = days.map(row => row.reasons.find(value => value.reason === bucket.reason)!);
    if (values.reduce((sum, row) => sum + row.count, 0) !== bucket.count || latest(values.map(row => row.lastRejectedAt)) !== bucket.lastRejectedAt) invalid();
  }
  return { meta: { projectId: meta.projectId, from, to, timeZone: 'UTC', dateBasis: 'receivedAt', generatedAt, retentionDays: 7, coverage: 'best-effort' }, summary: total, days };
}

export function rejectionRange(now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  return { from: shiftDate(to, -6), to };
}
