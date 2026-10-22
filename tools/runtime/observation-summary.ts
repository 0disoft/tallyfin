import { validCleanupMetrics, CLEANUP_LOG_PROJECT_LIMIT as CLEANUP_RUN_PROJECT_LIMIT, type CleanupMetrics } from './cleanup-metrics.ts';
import type { ErrorCode } from '@tallyfin/core';
import type { LatencyBucket, RequestOperation } from '../../apps/collector/src/request-observation.ts';
import type { CleanupReport } from '../../apps/collector/src/cleanup.ts';
import { diagnoseObservations } from './observation-diagnostics.ts';
import { SUMMARY_LIMITS, OPERATIONS, BUCKETS, CODES } from './observation-values.ts';
export { SUMMARY_LIMITS } from './observation-values.ts';
const KEYS = ['event', 'requestId', 'operation', 'status', 'code', 'latencyBucket', 'samplingDenominator'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Failure = 'invalid_log' | 'input_limit' | 'request_conflict' | 'run_conflict' | 'no_observations';
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

interface CleanupRun { report?: CleanupReport; failureMarker: boolean }
const CLEANUP_KEYS = ['runId', 'code', 'attempted', 'completed', 'failed', 'cursorAdvanced'];
function cleanupEntry(value: Record<string, unknown>): { runId: string; report?: CleanupReport } {
  const keys = value.code === 'retention_cleanup' ? [...CLEANUP_KEYS, ...(Object.hasOwn(value, 'metrics') ? ['metrics'] : [])] : ['runId', 'code'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
    typeof value.runId !== 'string' || !UUID.test(value.runId)) throw new ObservationSummaryError('invalid_log');
  const runId = value.runId.toLowerCase();
  if (value.code === 'retention_cleanup_failed') return { runId };
  for (const key of ['attempted', 'completed', 'failed']) {
    const count = value[key];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > CLEANUP_RUN_PROJECT_LIMIT)
      throw new ObservationSummaryError('invalid_log');
  }
  if (Number(value.completed) + Number(value.failed) !== value.attempted || typeof value.cursorAdvanced !== 'boolean')
    throw new ObservationSummaryError('invalid_log');
  if (Object.hasOwn(value, 'metrics') && !validCleanupMetrics(value.metrics, Number(value.completed))) throw new ObservationSummaryError('invalid_log');
  return { runId, report: { ...(value.metrics ? { metrics: value.metrics as CleanupMetrics } : {}), attempted: Number(value.attempted), completed: Number(value.completed),
    failed: Number(value.failed), cursorAdvanced: value.cursorAdvanced } };
}

function summarizeCleanup(runs: ReadonlyMap<string, CleanupRun>) {
  let failedRuns = 0;
  const summary = { observedRuns: runs.size, reportedRuns: 0, failureMarkerRuns: 0, reportlessFailureRuns: 0,
    attemptedProjects: 0, completedProjects: 0, failedProjects: 0, cursorAdvancedReports: 0, cursorNotAdvancedReports: 0 };
  let metrics: CleanupMetrics | undefined;
  for (const run of runs.values()) {
    if (run.failureMarker || (run.report && (run.report.failed > 0 || !run.report.cursorAdvanced))) failedRuns++;
    if (run.failureMarker) summary.failureMarkerRuns++;
    if (!run.report) { summary.reportlessFailureRuns++; continue; }
    summary.reportedRuns++;
    if (run.report.metrics) {
      const aggregate = metrics ??= { deletedRows: 0, saturatedTables: 0, oldestExpiredReceiptAgeMs: null, measuredProjects: 0, capacityLimitedProjects: 0 };
      for (const key of ['deletedRows', 'saturatedTables', 'measuredProjects', 'capacityLimitedProjects'] as const) aggregate[key] += run.report.metrics[key];
      const age = run.report.metrics.oldestExpiredReceiptAgeMs;
      if (age !== null) aggregate.oldestExpiredReceiptAgeMs = Math.max(aggregate.oldestExpiredReceiptAgeMs ?? 0, age);
    }
    summary.attemptedProjects += run.report.attempted;
    summary.completedProjects += run.report.completed;
    summary.failedProjects += run.report.failed;
    if (run.report.cursorAdvanced) summary.cursorAdvancedReports++;
    else summary.cursorNotAdvancedReports++;
  }
  return { summary: { ...summary, ...(metrics ? { metrics } : {}) }, failedRuns };
}

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

/** Bounded local aggregation; request/run IDs stay private and never enter the report. */
export class ObservationSummary {
  #bytes = 0; #lines = 0; #blank = 0; #ignored = 0; #duplicates = 0; #failure: Failure | null = null;
  #requests = new Map<string, string>();
  #cleanupRuns = new Map<string, CleanupRun>();
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
      if ('code' in value && (value.code === 'retention_cleanup' || value.code === 'retention_cleanup_failed')) {
        const parsed = cleanupEntry(value as Record<string, unknown>);
        const run = this.#cleanupRuns.get(parsed.runId) ?? { failureMarker: false };
        if (parsed.report) {
          if (run.report) {
            if (JSON.stringify(run.report) !== JSON.stringify(parsed.report)) throw new ObservationSummaryError('run_conflict');
            this.#duplicates++; return;
          }
          run.report = parsed.report;
        } else {
          if (run.failureMarker) { this.#duplicates++; return; }
          run.failureMarker = true;
        }
        this.#cleanupRuns.set(parsed.runId, run);
        return;
      }
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
    if (!this.#requests.size && !this.#cleanupRuns.size) throw new ObservationSummaryError('no_observations');
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
    const cleanup = summarizeCleanup(this.#cleanupRuns);
    return { schemaVersion: 'tallyfin.observation-summary/v2', coverage: 'provided-app-log-lines-only',
      exactRequestCounts: false, latencyPercentilesAvailable: false, timeWindowAvailable: false,
      input: { lines: this.#lines, blankLines: this.#blank, ignoredOtherLogLines: this.#ignored,
        duplicateLogLines: this.#duplicates }, ...total, operations, cleanup: cleanup.summary,
      diagnostics: diagnoseObservations(operations, cleanup.summary, cleanup.failedRuns, this.#ignored) };
  }
}
