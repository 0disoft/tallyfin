import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough, Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readObservationSummary, runObservationSummary, SUMMARY_HELP } from '../summarize-observations.ts';
import { SUMMARY_LIMITS } from '../observation-summary.ts';
import { sampleRequestObservation } from '../../../apps/collector/src/request-observation.ts';

const row = sampleRequestObservation({ requestId: '01000000-0000-4000-8000-000000000001',
  operation: 'browser_collection', status: 200, code: 'ok', latencyBucket: 'lt_50ms' })!;
const line = JSON.stringify(row);
function code(expected: string) { return (error: unknown) => error instanceof Error && error.message === expected; }
function released(input: Readable) {
  for (const event of ['data', 'end', 'error', 'close']) assert.equal(input.listenerCount(event), 0, event);
}

test('reads split UTF-8, CRLF and a final unterminated line and releases all owned listeners', async () => {
  const bytes = Buffer.from(JSON.stringify({ ignored: '한🙂' }) + '\r\n' + line + '\r\n' + line);
  const input = Readable.from([...bytes].map(byte => Buffer.from([byte])));
  const report = await readObservationSummary(input);
  assert.equal(report.observedResponses, 1); assert.equal(report.weightedRequestsEstimate, 64);
  assert.deepEqual(report.input, { lines: 3, blankLines: 0, ignoredOtherLogLines: 1, duplicateLogLines: 1 });
  released(input);
});

test('malformed and truncated UTF-8 or private records abort instead of returning partial successful input', async () => {
  for (const bytes of [Buffer.concat([Buffer.from(line + '\n'), Buffer.from([0xff])]),
    Buffer.concat([Buffer.from(line + '\n'), Buffer.from([0xe3, 0x81])]),
    Buffer.from(line + '\n' + JSON.stringify({ ...row, token: 'private-marker' })),
    Buffer.from(line + '\n{private-marker')]) {
    const input = Readable.from([bytes]);
    await assert.rejects(readObservationSummary(input), code('invalid_log')); released(input);
  }
});

test('input limits cover a line without newline and raw bytes before decoding', async () => {
  for (const bytes of [Buffer.alloc(SUMMARY_LIMITS.lineBytes + 1, 32), Buffer.alloc(SUMMARY_LIMITS.bytes + 1, 32)]) {
    const input = Readable.from([bytes]);
    await assert.rejects(readObservationSummary(input), code('input_limit')); released(input);
  }
});

test('deadline, stream error and early close reject without leaking underlying errors or keeping stdin active', async () => {
  const idle = new PassThrough();
  await assert.rejects(readObservationSummary(idle, 15), code('input_timeout'));
  assert.equal(idle.destroyed, true); released(idle);
  for (const error of [true, false]) {
    const input = new PassThrough(); const result = readObservationSummary(input);
    input.destroy(error ? new Error('private-stream-marker') : undefined);
    await assert.rejects(result, code('input_unavailable')); released(input);
  }
});

test('help, argument validation and TTY rejection never start reading input', async () => {
  const input = new PassThrough();
  assert.equal(await runObservationSummary(['--help'], input), SUMMARY_HELP);
  for (const args of [[], ['--file', 'private-path'], ['--stdin', '--stdin'], ['--help', '--stdin']])
    await assert.rejects(runObservationSummary(args, input), code('invalid_arguments'));
  Object.assign(input, { isTTY: true });
  await assert.rejects(runObservationSummary(['--stdin'], input), code('stdin_required')); released(input); input.destroy();
});

function cli(args: string[], input: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../summarize-observations.ts', import.meta.url)), ...args],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('cli-test-timeout')); }, 5000);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => { /* Child may reject flags before consuming input. */ });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.end(input);
  });
}

function closedOutput() {
  return new Promise<{ status: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../summarize-observations.ts', import.meta.url)), '--help'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('cli-test-timeout')); }, 5000);
    child.stdout.destroy();
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ status, stderr }); });
  });
}

test('actual Node CLI emits one JSON report or a fixed error on stderr with no partial/private output', async () => {
  const passed = await cli(['--stdin'], line + '\n');
  assert.equal(passed.status, 0); assert.equal(passed.stderr, '');
  assert.equal(JSON.parse(passed.stdout).weightedRequestsEstimate, 64);
  assert.ok(!passed.stdout.includes(row.requestId));
  const failed = await cli(['--stdin'], line + '\n' + JSON.stringify({ ...row, token: 'private-marker' }));
  assert.equal(failed.status, 1); assert.equal(failed.stdout, '');
  assert.deepEqual(JSON.parse(failed.stderr), { code: 'invalid_log' });
  const empty = await cli(['--stdin'], '');
  assert.equal(empty.status, 1); assert.equal(empty.stdout, '');
  assert.deepEqual(JSON.parse(empty.stderr), { code: 'no_observations' });
  const help = await cli(['--help'], '');
  assert.equal(help.status, 0); assert.equal(help.stderr, ''); assert.equal(help.stdout, SUMMARY_HELP + '\n');
  const broken = await closedOutput();
  assert.equal(broken.status, 1); assert.deepEqual(JSON.parse(broken.stderr), { code: 'output_unavailable' });
});

test('actual Node CLI supports cleanup-only and mixed logs and rejects conflicting run reports privately', async () => {
  const runId = 'ff000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const details = { runId, code: 'retention_cleanup', attempted: 2, completed: 1, failed: 1, cursorAdvanced: true };
  const marker = { runId, code: 'retention_cleanup_failed' };
  const markerOnly = await cli(['--stdin'], JSON.stringify(marker));
  assert.equal(markerOnly.status, 0); assert.equal(markerOnly.stderr, '');
  const uncovered = JSON.parse(markerOnly.stdout);
  assert.equal(uncovered.observedResponses, 0); assert.equal(uncovered.cleanup.reportedRuns, 0);
  assert.equal(uncovered.cleanup.reportlessFailureRuns, 1);
  const records = [marker, details, marker];
  for (const prefix of ['', line + '\n']) {
    const passed = await cli(['--stdin'], prefix + records.map(record => JSON.stringify(record)).join('\r\n'));
    assert.equal(passed.status, 0); assert.equal(passed.stderr, '');
    const report = JSON.parse(passed.stdout);
    assert.equal(report.schemaVersion, 'tallyfin.observation-summary/v2');
    assert.equal(report.observedResponses, prefix ? 1 : 0);
    assert.equal(report.cleanup.observedRuns, 1); assert.equal(report.cleanup.failedProjects, 1);
    assert.equal(report.diagnostics.serviceHealth, 'unknown');
    assert.deepEqual(report.diagnostics.findings, [{ code: 'cleanup_failures', severity: 'error',
      action: 'inspect_retention_cleanup', operation: 'retention_cleanup', unit: 'runs', observedCount: 1 }]);
    assert.equal(report.input.duplicateLogLines, 1);
    assert.ok(!passed.stdout.includes(runId) && !passed.stdout.includes('runId') && !passed.stdout.includes(row.requestId));
  }
  const rejected = await cli(['--stdin'], [details, { ...details, cursorAdvanced: false }].map(record => JSON.stringify(record)).join('\n'));
  assert.equal(rejected.status, 1); assert.equal(rejected.stdout, '');
  assert.deepEqual(JSON.parse(rejected.stderr), { code: 'run_conflict' });
  const privateField = await cli(['--stdin'], JSON.stringify({ ...marker, token: 'private-marker' }));
  assert.equal(privateField.status, 1); assert.equal(privateField.stdout, '');
  assert.deepEqual(JSON.parse(privateField.stderr), { code: 'invalid_log' });
});
