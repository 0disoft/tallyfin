import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObservationSummary, ObservationSummaryError, SUMMARY_LIMITS } from '../observation-summary.ts';
import { sampleRequestObservation } from '../../../apps/collector/src/request-observation.ts';

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
  summary.addLine(JSON.stringify({ code: 'retention_cleanup', privateValue: 'must-not-be-reported' }));
  const report = summary.report();
  assert.equal(report.observedResponses, 4); assert.equal(report.weightedRequestsEstimate, 130);
  assert.deepEqual(report.input, { lines: 7, blankLines: 1, ignoredOtherLogLines: 1, duplicateLogLines: 1 });
  assert.equal(report.coverage, 'provided-app-log-lines-only');
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
