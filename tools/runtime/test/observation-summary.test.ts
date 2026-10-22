import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObservationSummary, ObservationSummaryError, SUMMARY_LIMITS } from '../observation-summary.ts';
import { sampleRequestObservation } from '../../../apps/collector/src/request-observation.ts';
import { runCleanup } from '../../../apps/collector/src/cleanup.ts';
import { CLEANUP_RUN_PROJECT_LIMIT } from '../../../apps/collector/src/cleanup.ts';

const requestId = '01000000-0000-4000-8000-000000000001';
function log(overrides = {}) {
  return sampleRequestObservation({ requestId, operation: 'browser_collection', status: 200,
    code: 'ok', latencyBucket: 'lt_50ms', ...overrides })!;
}
function failed(code: string) {
  return (error: unknown) => error instanceof ObservationSummaryError && error.code === code && error.message === code;
}

test('summarizes actual emitter output with separate observed and weighted counts; output has no request IDs', () => {
  const summary = new ObservationSummary();
  const rows = [log(), log({ requestId: '02000000-0000-4000-8000-000000000002', status: 204 }),
    log({ requestId: 'ff000000-0000-4000-8000-000000000003', status: 503, code: 'storage_unavailable', latencyBucket: 'unknown' }),
    log({ requestId: 'ff000000-0000-4000-8000-000000000004', operation: 'server_collection', status: 403, code: 'forbidden' })];
  for (const row of rows) summary.addLine(JSON.stringify(row));
  summary.addLine(JSON.stringify(rows[0]));
  summary.addLine('');
  summary.addLine(JSON.stringify({ code: 'unrelated_log', privateValue: 'must-not-be-reported' }));
  const report = summary.report();
  assert.equal(report.observedResponses, 4); assert.equal(report.weightedRequestsEstimate, 130);
  assert.deepEqual(report.input, { lines: 7, blankLines: 1, ignoredOtherLogLines: 1, duplicateLogLines: 1 });
  assert.equal(report.coverage, 'provided-app-log-lines-only');
  assert.equal(report.schemaVersion, 'tallyfin.observation-summary/v2');
  assert.equal(report.cleanup.observedRuns, 0);
  assert.equal(report.exactRequestCounts, false); assert.equal(report.latencyPercentilesAvailable, false);
  assert.equal(report.timeWindowAvailable, false);
  assert.deepEqual(report.operations.map(row => [row.operation, row.observedResponses, row.weightedRequestsEstimate]),
    [['browser_collection', 3, 129], ['server_collection', 1, 1]]);
  assert.deepEqual(report.operations[0]!.latencyBuckets,
    [{ bucket: 'lt_50ms', observedResponses: 2, weightedRequestsEstimate: 128 },
      { bucket: 'unknown', observedResponses: 1, weightedRequestsEstimate: 1 }]);
  const encoded = JSON.stringify(report);
  assert.ok(!encoded.includes('requestId') && !encoded.includes(requestId) && !encoded.includes('must-not-be-reported'));
  report.operations[0]!.responses[0]!.observedResponses = 999;
  assert.equal(summary.report().operations[0]!.responses[0]!.observedResponses, 1);
});

const runId = 'ff000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function cleanup(overrides = {}) {
  return { runId, code: 'retention_cleanup', attempted: 3, completed: 2, failed: 1, cursorAdvanced: true, ...overrides };
}
function marker(id = runId) { return { runId: id, code: 'retention_cleanup_failed' }; }

test('summarizes cleanup report semantics from runCleanup and correlates its failure marker without double counting', async () => {
  const actual = await runCleanup({
    async nextCleanupPage() { return { projects: [
      { id: 'project-a', timeZone: 'UTC' }, { id: 'project-b', timeZone: 'UTC' }, { id: 'project-c', timeZone: 'UTC' },
    ], revision: 0 }; },
    async cleanup(projectId) { if (projectId === 'project-b') throw Error('private-storage-message'); },
    async advanceCleanupCursor() { return true; },
  }, 0);
  const summary = new ObservationSummary();
  summary.addLine(JSON.stringify({ runId, code: 'retention_cleanup', ...actual }));
  summary.addLine(JSON.stringify(marker()));
  const report = summary.report();
  assert.equal(report.observedResponses, 0); assert.equal(report.weightedRequestsEstimate, 0);
  assert.deepEqual(report.operations, []);
  assert.deepEqual(report.cleanup, { observedRuns: 1, reportedRuns: 1, failureMarkerRuns: 1, reportlessFailureRuns: 0,
    attemptedProjects: 3, completedProjects: 2, failedProjects: 1, cursorAdvancedReports: 1, cursorNotAdvancedReports: 0 });
  const encoded = JSON.stringify(report);
  for (const privateValue of [runId, 'runId', 'project-a', 'project-b', 'private-storage-message']) assert.ok(!encoded.includes(privateValue));
  report.cleanup.attemptedProjects = 99;
  assert.equal(summary.report().cleanup.attemptedProjects, 3);
});

test('cleanup markers may precede reports; duplicates normalize UUID/key order and reportless failures remain uncovered', () => {
  const summary = new ObservationSummary();
  for (const row of [marker(), marker(runId.toUpperCase()), cleanup(),
    Object.fromEntries(Object.entries(cleanup({ runId: runId.toUpperCase() })).reverse()),
    marker('ff000000-0000-4000-8000-000000000002'),
    cleanup({ runId: 'ff000000-0000-4000-8000-000000000003', attempted: 0, completed: 0, failed: 0, cursorAdvanced: false }), log()])
    summary.addLine(JSON.stringify(row));
  const report = summary.report();
  assert.equal(report.input.duplicateLogLines, 2); assert.equal(report.observedResponses, 1);
  assert.deepEqual(report.cleanup, { observedRuns: 3, reportedRuns: 2, failureMarkerRuns: 2, reportlessFailureRuns: 1,
    attemptedProjects: 3, completedProjects: 2, failedProjects: 1, cursorAdvancedReports: 1, cursorNotAdvancedReports: 1 });
  const onlyMarker = new ObservationSummary(); onlyMarker.addLine(JSON.stringify(marker()));
  assert.equal(onlyMarker.report().cleanup.reportlessFailureRuns, 1);
  assert.equal(onlyMarker.report().cleanup.reportedRuns, 0);
});

test('cleanup validation rejects private fields and impossible project counters; failures poison the whole summary', () => {
  const valid = new ObservationSummary();
  valid.addLine(JSON.stringify(cleanup({ attempted: CLEANUP_RUN_PROJECT_LIMIT, completed: CLEANUP_RUN_PROJECT_LIMIT, failed: 0 })));
  assert.equal(valid.report().cleanup.completedProjects, CLEANUP_RUN_PROJECT_LIMIT);
  const invalid = [cleanup({ attempted: CLEANUP_RUN_PROJECT_LIMIT + 1 }), cleanup({ completed: -1 }), cleanup({ failed: 0.5 }),
    cleanup({ attempted: '3' }), cleanup({ failed: 0 }), cleanup({ cursorAdvanced: 'true' }),
    cleanup({ runId: 'private-run-marker' }), cleanup({ token: 'private-marker' }),
    { ...marker(), failed: 1 }, { code: 'retention_cleanup_failed' },
    Object.fromEntries(Object.entries(cleanup()).filter(([key]) => key !== 'cursorAdvanced'))];
  for (const row of invalid) {
    const summary = new ObservationSummary(); summary.addLine(JSON.stringify(log()));
    assert.throws(() => summary.addLine(JSON.stringify(row)), failed('invalid_log'));
    assert.throws(() => summary.report(), failed('invalid_log'));
  }
});

test('conflicting cleanup details reject everything, while complementary markers are accepted', () => {
  const summary = new ObservationSummary();
  summary.addLine(JSON.stringify(cleanup())); summary.addLine(JSON.stringify(marker()));
  assert.throws(() => summary.addLine(JSON.stringify(cleanup({ cursorAdvanced: false }))), failed('run_conflict'));
  assert.throws(() => summary.report(), failed('run_conflict'));
  assert.throws(() => summary.addLine(JSON.stringify(log())), failed('run_conflict'));
});

test('rejects malformed/private fields, unbounded dimensions and invalid sampling without partial reports', () => {
  const invalid = [
    '{secret', 'null', '[]', '1',
    JSON.stringify({ ...log(), token: 'sensitive-value' }),
    JSON.stringify({ ...log(), operation: 'private-project-name' }),
    JSON.stringify({ ...log(), code: '__proto__' }),
    JSON.stringify({ ...log(), status: '200' }),
    JSON.stringify({ ...log(), status: 600 }),
    JSON.stringify({ ...log(), latencyBucket: 'private-value' }),
    JSON.stringify({ ...log(), requestId: 'secret' }),
    JSON.stringify({ ...log(), samplingDenominator: 1 }),
    JSON.stringify({ ...log(), requestId: 'ff000000-0000-4000-8000-000000000001' }),
    JSON.stringify({ ...log({ status: 503, code: 'storage_unavailable' }), samplingDenominator: 64 }),
  ];
  for (const line of invalid) {
    const summary = new ObservationSummary(); summary.addLine(JSON.stringify(log()));
    assert.throws(() => summary.addLine(line), failed('invalid_log'));
    assert.throws(() => summary.report(), failed('invalid_log'));
    assert.throws(() => summary.addLine(JSON.stringify(log())), failed('invalid_log'));
  }
});

test('deduplicates reordered and uppercase UUID lines but rejects conflicting observations of the same request', () => {
  const summary = new ObservationSummary();
  const row = log({ requestId: '01000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  summary.addLine(JSON.stringify(row));
  summary.addLine(JSON.stringify(Object.fromEntries(Object.entries({ ...row, requestId: row.requestId.toUpperCase() }).reverse())));
  assert.equal(summary.report().input.duplicateLogLines, 1);
  assert.throws(() => summary.addLine(JSON.stringify({ ...row, latencyBucket: 'unknown' })), failed('request_conflict'));
  assert.throws(() => summary.report(), failed('request_conflict'));
});

test('bounds individual bytes, total bytes and physical line count including ignored and empty records', () => {
  const oversized = new ObservationSummary();
  assert.throws(() => oversized.addLine('한'.repeat(Math.floor(SUMMARY_LIMITS.lineBytes / 3) + 1)), failed('input_limit'));
  const total = new ObservationSummary();
  const line = JSON.stringify({ padding: 'x'.repeat(SUMMARY_LIMITS.lineBytes - 14) });
  assert.equal(Buffer.byteLength(line), SUMMARY_LIMITS.lineBytes);
  assert.throws(() => {
    for (let i = 0; i <= Math.floor(SUMMARY_LIMITS.bytes / (SUMMARY_LIMITS.lineBytes + 1)); i++) total.addLine(line);
  }, failed('input_limit'));
  const count = new ObservationSummary();
  for (let i = 0; i < SUMMARY_LIMITS.lines; i++) count.addLine('');
  assert.throws(() => count.addLine(''), failed('input_limit'));
});

test('empty and platform-envelope-only input cannot look like a healthy observation report', () => {
  const summary = new ObservationSummary();
  assert.throws(() => summary.report(), failed('no_observations'));
  summary.addLine(JSON.stringify({ logs: [{ message: [JSON.stringify(log())] }], secret: 'not-output' }));
  assert.throws(() => summary.report(), failed('no_observations'));
});
