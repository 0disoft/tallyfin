import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObservationSummary } from '../observation-summary.ts';
import { sampleRequestObservation } from '../../../apps/collector/src/request-observation.ts';
import type { RequestObservation } from '../../../apps/collector/src/request-observation.ts';

let sequence = 0;
function request(overrides: Partial<RequestObservation> = {}) {
  return sampleRequestObservation({ requestId: `01000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`,
    operation: 'browser_collection', status: 200, code: 'ok', latencyBucket: 'lt_50ms', ...overrides })!;
}
function report(rows: unknown[]) {
  const summary = new ObservationSummary();
  for (const row of rows) summary.addLine(JSON.stringify(row));
  return summary.report();
}
function run(index: number, overrides = {}) {
  return { runId: `ff000000-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`,
    code: 'retention_cleanup', attempted: 3, completed: 3, failed: 0, cursorAdvanced: true, ...overrides };
}
function marker(index: number) { return { runId: run(index).runId, code: 'retention_cleanup_failed' }; }

test('successful sampled responses and complete observed cleanup reports never assert service health', () => {
  const result = report([request(), run(1), { logs: ['private-wrapper-value'] }]);
  assert.equal(result.weightedRequestsEstimate, 64);
  assert.equal(result.diagnostics.schemaVersion, 'tallyfin.observation-diagnostics/v1');
  assert.equal(result.diagnostics.serviceHealth, 'unknown');
  assert.deepEqual(result.diagnostics.findings, []);
  assert.deepEqual(result.diagnostics.coverage, { http: 'observed', cleanup: 'observed',
    cleanupDetails: 'complete_for_observed_runs', otherLogsIgnored: true });
  assert.ok(!JSON.stringify(result).includes('private-wrapper-value'));
});

test('partitions HTTP errors once per observed response and keeps expected client denials as review findings', () => {
  const storage = request({ status: 503, code: 'storage_unavailable' });
  const rows = [storage, storage, request({ status: 503, code: 'storage_unavailable' }),
    request({ status: 500, code: 'invalid_request' }),
    request({ status: 429, code: 'quota_exceeded' }),
    request({ status: 403, code: 'origin_denied' }), request({ status: 403, code: 'project_unavailable' }),
    request({ status: 422, code: 'unknown_schema' }),
    request({ status: 401, code: 'unauthorized' }), request({ status: 403, code: 'forbidden' }),
    request({ status: 400, code: 'invalid_event' }),
    request({ operation: 'administrator', status: 429, code: 'quota_exceeded' }),
    request({ operation: 'administrator', status: 409, code: 'last_owner' }),
    request({ operation: 'server_collection', status: 403, code: 'forbidden' }), request()];
  const result = report(rows);
  const findings = result.diagnostics.findings;
  assert.deepEqual(findings.map(item => [item.operation, item.code, item.severity, item.observedCount]), [
    ['browser_collection', 'storage_errors', 'error', 2],
    ['browser_collection', 'server_errors', 'error', 1],
    ['browser_collection', 'collection_quota_rejections', 'review', 1],
    ['browser_collection', 'collection_configuration_rejections', 'review', 3],
    ['browser_collection', 'access_denials', 'review', 2],
    ['browser_collection', 'request_rejections', 'review', 1],
    ['server_collection', 'access_denials', 'review', 1],
    ['administrator', 'request_rejections', 'review', 2],
  ]);
  assert.equal(findings.reduce((total, item) => total + item.observedCount, 0), result.observedResponses - 1);
  assert.equal(result.input.duplicateLogLines, 1);
  assert.ok(findings.every(item => item.unit === 'responses'));
  assert.equal(findings[0]!.action, 'inspect_storage');
  assert.equal(result.diagnostics.coverage.cleanup, 'unobserved');
  assert.equal(result.diagnostics.coverage.cleanupDetails, 'unobserved');
  assert.deepEqual(report([...rows].reverse()).diagnostics, result.diagnostics);
  findings[0]!.observedCount = 999;
  assert.equal(report(rows).diagnostics.findings[0]!.observedCount, 2);
});

test('cleanup failure diagnosis counts the union of markers, project failures and stalled cursors', () => {
  const rows = [run(1, { completed: 2, failed: 1, cursorAdvanced: false }), marker(1), marker(1),
    run(2, { cursorAdvanced: false }), run(3), marker(3), marker(4), run(5)];
  const result = report(rows);
  assert.equal(result.cleanup.observedRuns, 5);
  assert.deepEqual(result.diagnostics.findings, [
    { code: 'cleanup_failures', severity: 'error', action: 'inspect_retention_cleanup', operation: 'retention_cleanup', unit: 'runs', observedCount: 4 },
    { code: 'cleanup_report_missing', severity: 'review', action: 'inspect_cleanup_log_coverage', operation: 'retention_cleanup', unit: 'runs', observedCount: 1 },
  ]);
  assert.deepEqual(result.diagnostics.coverage, { http: 'unobserved', cleanup: 'observed',
    cleanupDetails: 'partial_for_observed_runs', otherLogsIgnored: false });
  assert.deepEqual(report([...rows].reverse()).diagnostics, result.diagnostics);
  assert.ok(!JSON.stringify(result).includes('ff000000-aaaa-4aaa-8aaa'));
});

test('marker-only cleanup evidence is a failure with no claimed coverage of HTTP or detailed project outcomes', () => {
  const result = report([marker(1)]);
  assert.equal(result.diagnostics.serviceHealth, 'unknown');
  assert.deepEqual(result.diagnostics.coverage, { http: 'unobserved', cleanup: 'observed',
    cleanupDetails: 'unobserved', otherLogsIgnored: false });
  assert.equal(result.diagnostics.findings[0]!.observedCount, 1);
  assert.equal(result.cleanup.failedProjects, 0);
});
