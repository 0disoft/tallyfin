import type { ErrorCode } from '@tallyfin/core';
import type { LatencyBucket, RequestOperation } from '../../apps/collector/src/request-observation.ts';

export const SUMMARY_LIMITS = { bytes: 8 * 1024 * 1024, lines: 50000, lineBytes: 16384 } as const;
const OPERATIONS = ['browser_collection', 'server_collection', 'administrator', 'other'] as const satisfies readonly RequestOperation[];
const BUCKETS = ['lt_10ms', 'lt_50ms', 'lt_250ms', 'lt_1000ms', 'gte_1000ms', 'unknown'] as const satisfies readonly LatencyBucket[];
const CODES: Record<ErrorCode | 'ok', true> = {
  ok: true, invalid_request: true, invalid_event: true, unknown_schema: true, origin_denied: true,
  project_unavailable: true, event_conflict: true, attempt_conflict: true, quota_exceeded: true,
  unauthorized: true, forbidden: true, not_found: true, storage_unavailable: true, settings_conflict: true,
  schema_conflict: true, project_conflict: true, project_limit_reached: true, grant_conflict: true,
  last_owner: true, publisher_conflict: true,
};
const KEYS = ['event', 'requestId', 'operation', 'status', 'code', 'latencyBucket', 'samplingDenominator'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Failure = 'invalid_log' | 'input_limit' | 'request_conflict' | 'no_observations';
export class ObservationSummaryError extends Error {
  readonly code: Failure;
  constructor(code: Failure) { super(code); this.name = 'ObservationSummaryError'; this.code = code; }
}
interface Entry {
  requestId: string; operation: RequestOperation; status: number; code: ErrorCode | 'ok';
  latencyBucket: LatencyBucket; samplingDenominator: 1 | 64;
}
interface Counts { observedResponses: number; weightedRequestsEstimate: number }
interface ResponseGroup extends Counts { status: number; code: ErrorCode | 'ok' }
function counts(): Counts { return { observedResponses: 0, weightedRequestsEstimate: 0 }; }
function add(count: Counts, weight: number) { count.observedResponses++; count.weightedRequestsEstimate += weight; }

/** Accept the app's JSON line, not platform envelopes or arbitrary request details. */
function entry(value: Record<string, unknown>): Entry {
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || keys.some(key => !KEYS.includes(key)) ||
    typeof value.requestId !== 'string' || !UUID.test(value.requestId) ||
    !OPERATIONS.includes(value.operation as RequestOperation) ||
    !Number.isInteger(value.status) || Number(value.status) < 100 || Number(value.status) > 599 ||
    typeof value.code !== 'string' || !Object.hasOwn(CODES, value.code) ||
    !BUCKETS.includes(value.latencyBucket as LatencyBucket)) throw new ObservationSummaryError('invalid_log');
  const sampled = value.code === 'ok' && (value.status === 200 || value.status === 204);
  if (value.samplingDenominator !== (sampled ? 64 : 1) ||
    (sampled && Number.parseInt(value.requestId.slice(0, 2), 16) >= 4)) throw new ObservationSummaryError('invalid_log');
  return { requestId: value.requestId.toLowerCase(), operation: value.operation as RequestOperation,
    status: Number(value.status), code: value.code as Entry['code'], latencyBucket: value.latencyBucket as LatencyBucket,
    samplingDenominator: sampled ? 64 : 1 };
}

/** Bounded local aggregation; request IDs stay private and never enter the report. */
export class ObservationSummary {
  #bytes = 0; #lines = 0; #blank = 0; #ignored = 0; #duplicates = 0; #failure: Failure | null = null;
  #requests = new Map<string, string>();
  #operations = new Map<RequestOperation, { total: Counts; responses: Map<string, ResponseGroup>; latency: Map<LatencyBucket, Counts> }>();
  addLine(line: string): void {
    if (this.#failure) throw new ObservationSummaryError(this.#failure);
    try {
      const size = Buffer.byteLength(line, 'utf8');
      this.#bytes += size + 1; this.#lines++;
      if (size > SUMMARY_LIMITS.lineBytes || this.#bytes > SUMMARY_LIMITS.bytes || this.#lines > SUMMARY_LIMITS.lines)
        throw new ObservationSummaryError('input_limit');
      if (!line.trim()) { this.#blank++; return; }
      let value: unknown;
      try { value = JSON.parse(line); } catch { throw new ObservationSummaryError('invalid_log'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ObservationSummaryError('invalid_log');
      if (!('event' in value) || value.event !== 'http_request') { this.#ignored++; return; }
      const parsed = entry(value as Record<string, unknown>);
      const signature = JSON.stringify([parsed.operation, parsed.status, parsed.code, parsed.latencyBucket, parsed.samplingDenominator]);
      const existing = this.#requests.get(parsed.requestId);
      if (existing !== undefined) {
        if (existing !== signature) throw new ObservationSummaryError('request_conflict');
        this.#duplicates++; return;
      }
      this.#requests.set(parsed.requestId, signature);
      let operation = this.#operations.get(parsed.operation);
      if (!operation) {
        operation = { total: counts(), responses: new Map(), latency: new Map() };
        this.#operations.set(parsed.operation, operation);
      }
      const responseKey = `${parsed.status}:${parsed.code}`;
      let response = operation.responses.get(responseKey);
      if (!response) { response = { status: parsed.status, code: parsed.code, ...counts() }; operation.responses.set(responseKey, response); }
      let latency = operation.latency.get(parsed.latencyBucket);
      if (!latency) { latency = counts(); operation.latency.set(parsed.latencyBucket, latency); }
      for (const counter of [operation.total, response, latency]) add(counter, parsed.samplingDenominator);
    } catch (error) {
      this.#failure = error instanceof ObservationSummaryError ? error.code : 'invalid_log';
      throw new ObservationSummaryError(this.#failure);
    }
  }
  report() {
    if (this.#failure) throw new ObservationSummaryError(this.#failure);
    if (!this.#requests.size) throw new ObservationSummaryError('no_observations');
    const total = counts();
    const operations = OPERATIONS.flatMap(operation => {
      const state = this.#operations.get(operation); if (!state) return [];
      total.observedResponses += state.total.observedResponses;
      total.weightedRequestsEstimate += state.total.weightedRequestsEstimate;
      return [{ operation, ...state.total,
        responses: [...state.responses.values()].sort((a, b) => a.status - b.status || a.code.localeCompare(b.code))
          .map(response => ({ ...response })),
        latencyBuckets: BUCKETS.flatMap(bucket => {
          const count = state.latency.get(bucket); return count ? [{ bucket, ...count }] : [];
        }),
      }];
    });
    return { schemaVersion: 'tallyfin.observation-summary/v1', coverage: 'provided-app-log-lines-only',
      exactRequestCounts: false, latencyPercentilesAvailable: false, timeWindowAvailable: false,
      input: { lines: this.#lines, blankLines: this.#blank, ignoredOtherLogLines: this.#ignored,
        duplicateLogLines: this.#duplicates }, ...total, operations };
  }
}
