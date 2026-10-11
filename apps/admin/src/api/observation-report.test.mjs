/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObservationSummary } from '../../../../tools/runtime/observation-summary.ts';
import { sampleRequestObservation } from '../../../collector/src/request-observation.ts';
import { observationReportText, parseObservationReport, ReportError } from './observation-report.ts';
import { ReportReader } from './observation-reader.ts';

function summary(lines = []) {
  const source = new ObservationSummary();
  source.addLine(JSON.stringify(sampleRequestObservation({ requestId: '01000000-0000-4000-8000-000000000001',
    operation: 'browser_collection', status: 200, code: 'ok', latencyBucket: 'lt_50ms' })));
  source.addLine(JSON.stringify(sampleRequestObservation({ requestId: 'ff000000-0000-4000-8000-000000000001',
    operation: 'administrator', status: 503, code: 'storage_unavailable', latencyBucket: 'unknown' })));
  lines.forEach(line => source.addLine(JSON.stringify(line))); return source.report();
}
test('actual CLI report round-trips without request identities; JSON key order and legacy v2 diagnostics remain supported', () => {
  const source = summary(); assert.deepEqual(observationReportText(JSON.stringify(source)), source);
  const reverse = Object.fromEntries(Object.entries(source).reverse()); assert.deepEqual(parseObservationReport(reverse), source);
  delete reverse.diagnostics; assert.equal(parseObservationReport(reverse).diagnostics, null);
  assert.equal(parseObservationReport(source).diagnostics.serviceHealth, 'unknown');
  assert.ok(!JSON.stringify(parseObservationReport(source)).includes('requestId'));
});
test('actual overlapping cleanup markers and partial details retain run counts without pretending missing processing counts are zero', () => {
  const source = summary([
    { runId: '01000000-0000-4000-8000-000000000002', code: 'retention_cleanup', attempted: 1, completed: 1, failed: 0, cursorAdvanced: false },
    { runId: '01000000-0000-4000-8000-000000000002', code: 'retention_cleanup_failed' },
    { runId: '01000000-0000-4000-8000-000000000003', code: 'retention_cleanup_failed' },
  ]);
  const result = parseObservationReport(source); assert.deepEqual(result, source);
  assert.equal(result.cleanup.observedRuns, 2); assert.equal(result.cleanup.reportlessFailureRuns, 1);
  assert.equal(result.diagnostics.findings.find(item => item.code === 'cleanup_failures').observedCount, 2);
  assert.equal(result.diagnostics.coverage.cleanupDetails, 'partial_for_observed_runs');
  const onlyCleanup = new ObservationSummary();
  onlyCleanup.addLine(JSON.stringify({ runId: '01000000-0000-4000-8000-000000000003', code: 'retention_cleanup_failed' }));
  assert.deepEqual(parseObservationReport(onlyCleanup.report()), onlyCleanup.report());
});
test('raw logs, private extra fields, unsupported schemas and invented health or time coverage never become displayable reports', () => {
  const source = summary();
  const cases = [null, [], {}, { ...source, schemaVersion: 'tallyfin.observation-summary/v1' },
    { ...source, token: 'private-marker' }, { ...source, timeWindowAvailable: true },
    { ...source, input: { ...source.input, path: 'private-marker' } },
    { ...source, diagnostics: { ...source.diagnostics, serviceHealth: 'ok' } },
    { ...source, diagnostics: { ...source.diagnostics, coverage: { ...source.diagnostics.coverage, http: {} } } },
    { event: 'http_request', requestId: 'private-marker' }];
  for (const value of cases) assert.throws(() => parseObservationReport(value), error => error instanceof ReportError && error.message === 'invalid_report');
  assert.throws(() => observationReportText('invalid private-marker'), ReportError);
});
test('inconsistent totals, sampling estimates, duplicate response groups, unsafe counts and altered diagnostics fail closed', () => {
  const mutate = changes => { const value = structuredClone(summary()); changes(value); return value; };
  const cases = [
    mutate(value => value.observedResponses++), mutate(value => value.input.lines++),
    mutate(value => value.operations[0].responses[0].weightedRequestsEstimate = 1),
    mutate(value => value.operations[0].latencyBuckets[0].observedResponses++),
    mutate(value => value.operations[0].responses.push(value.operations[0].responses[0])),
    mutate(value => value.operations[0].responses[0].code = 'private-marker'),
    mutate(value => value.cleanup.reportedRuns = 1),
    mutate(value => value.observedResponses = Number.MAX_SAFE_INTEGER + 1),
    mutate(value => value.diagnostics.findings[0].observedCount = 2),
    mutate(value => value.diagnostics.findings[0].severity = 'review'),
    mutate(value => value.diagnostics.coverage.http = 'unobserved'),
  ];
  for (const value of cases) assert.throws(() => parseObservationReport(value), ReportError);
});

function workers() {
  const list = [];
  return { list, create() {
    const worker = { onmessage: null, onerror: null, terminated: 0, sent: null,
      postMessage(file) { this.sent = file; }, terminate() { this.terminated++; } };
    list.push(worker); return worker;
  } };
}
test('reader creates workers only on selection, bounds files and clears prior success on a new invalid report', () => {
  const ports = workers(), reader = new ReportReader(() => {}, () => ports.create());
  assert.equal(ports.list.length, 0);
  reader.read({ size: 8 * 1024 * 1024 + 1 }); assert.equal(reader.state.phase, 'error'); assert.equal(ports.list.length, 0);
  const file = new File(['{}'], 'report.json'); reader.read(file); assert.equal(reader.state.phase, 'loading');
  const current = ports.list[0]; assert.equal(current.sent, file);
  current.onmessage({ data: { ok: true, report: summary() } }); assert.equal(reader.state.phase, 'ready'); assert.equal(current.terminated, 1);
  reader.read(file); assert.equal(reader.state.report, null);
  ports.list[1].onmessage({ data: { ok: false, code: 'private-marker' } });
  assert.equal(reader.state.phase, 'error'); assert.equal(reader.state.report, null); assert.ok(!reader.state.message.includes('private-marker'));
  reader.destroy();
});
test('new selection, panel close and disposal terminate work and discard late results', () => {
  const ports = workers(), reader = new ReportReader(() => {}, () => ports.create());
  const file = new File(['{}'], 'report.json'); reader.read(file);
  const firstReply = ports.list[0].onmessage; reader.read(file);
  firstReply({ data: { ok: true, report: summary() } }); assert.equal(reader.state.phase, 'loading');
  const secondReply = ports.list[1].onmessage; reader.close(); secondReply({ data: { ok: true, report: summary() } });
  assert.equal(reader.state.phase, 'idle'); assert.equal(reader.state.report, null);
  reader.read(file); const thirdReply = ports.list[2].onmessage; reader.destroy();
  thirdReply({ data: { ok: true, report: summary() } }); reader.read(file);
  assert.equal(reader.state.phase, 'idle'); assert.equal(ports.list.length, 3);
  assert.ok(ports.list.every(worker => worker.terminated === 1));
});
test('worker startup errors and read deadline use fixed messages and dispose the worker', async () => {
  const file = new File(['{}'], 'report.json');
  const broken = new ReportReader(() => {}, () => { throw Error('private-marker'); }); broken.read(file);
  assert.equal(broken.state.phase, 'error'); assert.ok(!broken.state.message.includes('private-marker')); broken.destroy();
  const ports = workers(); let end;
  const ended = new Promise(resolve => { end = resolve; });
  const reader = new ReportReader(state => { if (state.phase === 'error') end(); }, () => ports.create(), 15);
  reader.read(file); const late = ports.list[0].onmessage; await ended;
  late({ data: { ok: true, report: summary() } }); assert.equal(reader.state.phase, 'error'); assert.equal(reader.state.report, null);
  assert.equal(ports.list[0].terminated, 1); reader.destroy();
});
