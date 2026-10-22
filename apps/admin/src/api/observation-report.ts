import type { ErrorCode } from '@tallyfin/core';
import type { RequestOperation, LatencyBucket } from '../../../../apps/collector/src/request-observation.ts';
import { CLEANUP_LOG_PROJECT_LIMIT as CLEANUP_RUN_PROJECT_LIMIT, validCleanupMetrics, type CleanupMetrics } from '../../../../tools/runtime/cleanup-metrics.ts';
import { SUMMARY_LIMITS, OPERATIONS, BUCKETS, CODES } from '../../../../tools/runtime/observation-values.ts';
import { diagnoseObservations } from '../../../../tools/runtime/observation-diagnostics.ts';
import { validCleanupExecutionSummary, type CleanupExecutionSummary } from '../../../../tools/runtime/cleanup-execution.ts';

export const REPORT_BYTE_LIMIT = SUMMARY_LIMITS.bytes;
type Counts = { observedResponses: number; weightedRequestsEstimate: number };
type Operation = Counts & { operation: RequestOperation; responses: (Counts & { status: number; code: ErrorCode | 'ok' })[];
  latencyBuckets: (Counts & { bucket: LatencyBucket })[] };
type Cleanup = { observedRuns: number; reportedRuns: number; failureMarkerRuns: number; reportlessFailureRuns: number;
  attemptedProjects: number; completedProjects: number; failedProjects: number; cursorAdvancedReports: number; cursorNotAdvancedReports: number; metrics?: CleanupMetrics; execution?: CleanupExecutionSummary };
export type ObservationReport = Counts & { schemaVersion: 'tallyfin.observation-summary/v2'; coverage: 'provided-app-log-lines-only';
  exactRequestCounts: false; latencyPercentilesAvailable: false; timeWindowAvailable: false;
  input: { lines: number; blankLines: number; ignoredOtherLogLines: number; duplicateLogLines: number };
  operations: Operation[]; cleanup: Cleanup; diagnostics: ReturnType<typeof diagnoseObservations> | null };

export class ReportError extends Error {
  readonly code: 'invalid_report' | 'report_limit';
  constructor(code: 'invalid_report' | 'report_limit' = 'invalid_report') { super(code); this.name = 'ReportError'; this.code = code; }
}
function require(condition: unknown): asserts condition { if (!condition) throw new ReportError(); }
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  require(value && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  require(keys.every(key => Object.hasOwn(result, key)) && Object.keys(result).every(key => keys.includes(key) || optional.includes(key)));
  return result;
}
function count(value: unknown, positive = false): number {
  require(typeof value === 'number' && Number.isSafeInteger(value) && value >= (positive ? 1 : 0)); return value;
}
function array(value: unknown, limit: number): unknown[] { require(Array.isArray(value) && value.length <= limit); return value; }
function enumValue<T extends string>(value: unknown, values: readonly T[]): T { require(values.includes(value as T)); return value as T; }
function counts(value: Record<string, unknown>, positive = false): Counts {
  const observedResponses = count(value.observedResponses, positive), weightedRequestsEstimate = count(value.weightedRequestsEstimate, positive);
  require(weightedRequestsEstimate >= observedResponses && weightedRequestsEstimate <= observedResponses * 64 &&
    (weightedRequestsEstimate - observedResponses) % 63 === 0);
  return { observedResponses, weightedRequestsEstimate };
}
function sum(values: readonly number[]) { const total = values.reduce((a, b) => a + b, 0); require(Number.isSafeInteger(total)); return total; }
function sameCounts(total: Counts, parts: readonly Counts[]) {
  require(total.observedResponses === sum(parts.map(part => part.observedResponses)) &&
    total.weightedRequestsEstimate === sum(parts.map(part => part.weightedRequestsEstimate)));
}
function distinct(values: readonly string[]) { require(new Set(values).size === values.length); }
const COUNT_KEYS = ['observedResponses', 'weightedRequestsEstimate'];
const CLEANUP_KEYS = ['observedRuns', 'reportedRuns', 'failureMarkerRuns', 'reportlessFailureRuns', 'attemptedProjects',
  'completedProjects', 'failedProjects', 'cursorAdvancedReports', 'cursorNotAdvancedReports'] as const;
function cleanup(value: unknown): Cleanup {
  const row = object(value, CLEANUP_KEYS, ['metrics', 'execution']), result: Cleanup = Object.fromEntries(CLEANUP_KEYS.map(key => [key, count(row[key])])) as Record<typeof CLEANUP_KEYS[number], number>;
  if (Object.hasOwn(row, 'execution')) { require(validCleanupExecutionSummary(row.execution, result)); result.execution = structuredClone(row.execution); }
  if (Object.hasOwn(row, 'metrics')) { require(validCleanupMetrics(row.metrics, result.completedProjects)); result.metrics = row.metrics; }
  require(result.observedRuns === result.reportedRuns + result.reportlessFailureRuns &&
    result.failureMarkerRuns >= result.reportlessFailureRuns && result.failureMarkerRuns <= result.observedRuns &&
    result.completedProjects + result.failedProjects + (result.execution?.interruptedProjects ?? 0) === result.attemptedProjects &&
    result.attemptedProjects <= result.reportedRuns * CLEANUP_RUN_PROJECT_LIMIT &&
    result.cursorAdvancedReports + result.cursorNotAdvancedReports === result.reportedRuns);
  return result;
}
// Compare only validated, projected diagnostics so key order does not matter and unknown fields never survive.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function diagnostics(value: unknown, operations: Operation[], cleaned: Cleanup, ignored: number) {
  const row = object(value, ['schemaVersion', 'serviceHealth', 'coverage', 'findings']);
  require(row.schemaVersion === 'tallyfin.observation-diagnostics/v1' && row.serviceHealth === 'unknown');
  const coverageRow = object(row.coverage, ['http', 'cleanup', 'cleanupDetails', 'otherLogsIgnored']);
  require(typeof coverageRow.otherLogsIgnored === 'boolean');
  const coverage = { http: enumValue(coverageRow.http, ['observed', 'unobserved']),
    cleanup: enumValue(coverageRow.cleanup, ['observed', 'unobserved']),
    cleanupDetails: enumValue(coverageRow.cleanupDetails, ['complete_for_observed_runs', 'partial_for_observed_runs', 'unobserved']),
    otherLogsIgnored: coverageRow.otherLogsIgnored };
  const findings = array(row.findings, 26).map(value => {
    const item = object(value, ['code', 'severity', 'operation', 'unit', 'observedCount', 'action']);
    require(['code', 'severity', 'operation', 'unit', 'action'].every(key => typeof item[key] === 'string'));
    return { code: item.code, severity: item.severity, action: item.action, operation: item.operation, unit: item.unit,
      observedCount: count(item.observedCount, true) };
  });
  distinct(findings.map(item => `${item.operation}:${item.code}`));
  const failedRuns = findings.find(item => item.code === 'cleanup_failures')?.observedCount ?? 0;
  const knownFailed = cleaned.execution?.failedRuns ?? 0;
  const legacyUnadvanced = cleaned.cursorNotAdvancedReports - (cleaned.execution?.cursorNotAdvancedRuns ?? 0);
  const legacyRuns = cleaned.reportedRuns - (cleaned.execution?.reportedRuns ?? 0);
  const lower = Math.max(cleaned.failureMarkerRuns, knownFailed + legacyUnadvanced, Math.ceil(cleaned.failedProjects / CLEANUP_RUN_PROJECT_LIMIT));
  const upper = Math.min(cleaned.observedRuns, cleaned.failureMarkerRuns + knownFailed + legacyUnadvanced + Math.min(cleaned.failedProjects, legacyRuns));
  require(failedRuns >= lower && failedRuns <= upper);
  const expected = diagnoseObservations(operations, cleaned, failedRuns, ignored);
  require(JSON.stringify(canonical({ ...row, coverage, findings })) === JSON.stringify(canonical(expected)));
  return expected;
}

/** Read CLI output only. Raw NDJSON, unknown/private fields and inconsistent totals are rejected. */
export function parseObservationReport(value: unknown): ObservationReport {
  const row = object(value, ['schemaVersion', 'coverage', 'exactRequestCounts', 'latencyPercentilesAvailable',
    'timeWindowAvailable', 'input', ...COUNT_KEYS, 'operations', 'cleanup'], ['diagnostics']);
  require(row.schemaVersion === 'tallyfin.observation-summary/v2' && row.coverage === 'provided-app-log-lines-only' &&
    row.exactRequestCounts === false && row.latencyPercentilesAvailable === false && row.timeWindowAvailable === false);
  const inputRow = object(row.input, ['lines', 'blankLines', 'ignoredOtherLogLines', 'duplicateLogLines']);
  const input = { lines: count(inputRow.lines, true), blankLines: count(inputRow.blankLines),
    ignoredOtherLogLines: count(inputRow.ignoredOtherLogLines), duplicateLogLines: count(inputRow.duplicateLogLines) };
  require(input.lines <= SUMMARY_LIMITS.lines);
  const operations = array(row.operations, OPERATIONS.length).map(value => {
    const item = object(value, ['operation', ...COUNT_KEYS, 'responses', 'latencyBuckets']);
    const operation = enumValue(item.operation, OPERATIONS), total = counts(item, true);
    const responses = array(item.responses, SUMMARY_LIMITS.lines).map(value => {
      const response = object(value, ['status', 'code', ...COUNT_KEYS]);
      const status = count(response.status); require(status >= 100 && status <= 599);
      require(typeof response.code === 'string' && Object.hasOwn(CODES, response.code));
      const code = response.code as ErrorCode | 'ok', counted = counts(response, true);
      require(counted.weightedRequestsEstimate === counted.observedResponses * (code === 'ok' && (status === 200 || status === 204) ? 64 : 1));
      return { status, code, ...counted };
    });
    const latencyBuckets = array(item.latencyBuckets, BUCKETS.length).map(value => {
      const bucket = object(value, ['bucket', ...COUNT_KEYS]); return { bucket: enumValue(bucket.bucket, BUCKETS), ...counts(bucket, true) };
    });
    distinct(responses.map(response => `${response.status}:${response.code}`)); distinct(latencyBuckets.map(bucket => bucket.bucket));
    sameCounts(total, responses); sameCounts(total, latencyBuckets);
    return { operation, ...total, responses, latencyBuckets };
  });
  distinct(operations.map(item => item.operation));
  const total = counts(row), cleaned = cleanup(row.cleanup); sameCounts(total, operations);
  require(total.observedResponses + cleaned.observedRuns > 0 && input.lines === sum([total.observedResponses, cleaned.reportedRuns,
    cleaned.failureMarkerRuns, input.blankLines, input.ignoredOtherLogLines, input.duplicateLogLines]));
  return { schemaVersion: 'tallyfin.observation-summary/v2', coverage: 'provided-app-log-lines-only',
    exactRequestCounts: false, latencyPercentilesAvailable: false, timeWindowAvailable: false, input, ...total, operations,
    cleanup: cleaned, diagnostics: Object.hasOwn(row, 'diagnostics') ? diagnostics(row.diagnostics, operations, cleaned, input.ignoredOtherLogLines) : null };
}
export function observationReportText(text: string): ObservationReport {
  if (new TextEncoder().encode(text).byteLength > REPORT_BYTE_LIMIT) throw new ReportError('report_limit');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new ReportError(); }
  return parseObservationReport(value);
}
