import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWranglerTailSummary, runObservationSummary } from '../summarize-observations.ts';
import { ObservationSummary, SUMMARY_LIMITS } from '../observation-summary.ts';
import { TAIL_LIMITS } from '../wrangler-tail-input.ts';
import { parseObservationReport } from '../../../apps/admin/src/api/observation-report.ts';

const request = { event: 'http_request', requestId: '01000000-0000-4000-8000-000000000001',
  operation: 'browser_collection', status: 200, code: 'ok', latencyBucket: 'lt_50ms', samplingDenominator: 64 };
const cleanup = { runId: 'ff000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: 'retention_cleanup',
  attempted: 2, completed: 1, failed: 1, cursorAdvanced: true };
const wrap = (records: unknown[]) => ({ outcome: 'ok', scriptName: 'private-script-marker',
  exceptions: [{ message: 'private-exception-marker' }], eventTimestamp: 1590680082349,
  event: { request: { url: 'https://example.invalid/private-url-marker', headers: { authorization: 'private-header-marker' } } },
  logs: records.map(row => ({ level: 'log', message: [JSON.stringify(row)], timestamp: 1590680082349 })) });
const stream = (text: string) => Readable.from([Buffer.from(text)]);
const code = (expected: string) => (error: unknown) => error instanceof Error && error.message === expected;
function released(input: Readable) {
  for (const event of ['data', 'end', 'error', 'close']) assert.equal(input.listenerCount(event), 0, event);
}

test('Wrangler pretty and compact envelopes produce the existing private v2 browser report', async () => {
  for (const indent of [undefined, 2]) {
    const text = [wrap([request, cleanup]), wrap([request, { code: 'retention_cleanup_failed', runId: cleanup.runId }])]
      .map(row => JSON.stringify(row, null, indent)).join('\r\n');
    const input = stream(text); const report = await readWranglerTailSummary(input); released(input);
    const expected = new ObservationSummary();
    for (const row of [request, cleanup, request, { code: 'retention_cleanup_failed', runId: cleanup.runId }])
      expected.addLine(JSON.stringify(row));
    assert.deepEqual(report, expected.report());
    assert.equal(report.input.duplicateLogLines, 1);
    assert.ok(parseObservationReport(report));
    for (const marker of ['private-', request.requestId, cleanup.runId, 'scriptName', 'eventTimestamp'])
      assert.ok(!JSON.stringify(report).includes(marker));
  }
});

test('escaped braces, quotes, backslashes and byte-split UTF-8 do not alter framing', async () => {
  const envelope = wrap([request]);
  envelope.logs.unshift({ level: 'log', message: ['한🙂 } { ] " \\ private-marker'], timestamp: 0 });
  const bytes = Buffer.from(JSON.stringify(envelope, null, 2));
  const input = Readable.from([...bytes].map(byte => Buffer.from([byte])));
  const report = await readWranglerTailSummary(input); released(input);
  assert.equal(report.observedResponses, 1); assert.equal(report.input.ignoredOtherLogLines, 1);
  assert.ok(!JSON.stringify(report).includes('private-marker'));
});

test('unrelated console arguments are ignored but recognizable multi-argument/object app logs fail', async () => {
  const envelope = wrap([request]);
  envelope.logs.push({ level: 'log', message: ['prefix', 'private-marker'], timestamp: 0 });
  assert.equal((await readWranglerTailSummary(stream(JSON.stringify(envelope)))).input.ignoredOtherLogLines, 1);
  for (const message of [[JSON.stringify(request), 'extra'], [request]]) {
    const invalid = { logs: [{ message }] };
    await assert.rejects(readWranglerTailSummary(stream(JSON.stringify(invalid))), code('invalid_log'));
  }
});

test('malformed shapes, truncated frames, non-JSON banners and malformed app records reject the whole input', async () => {
  const valid = JSON.stringify(wrap([request]));
  for (const suffix of ['{', '{"logs":[]', '{]', '[{}]', 'null', 'banner-private-marker', valid,
    JSON.stringify({}), JSON.stringify({ logs: 'wrong' }), JSON.stringify({ logs: [{ message: 'wrong' }] }),
    JSON.stringify(wrap([{ ...request, token: 'private-token-marker' }])),
    JSON.stringify({ logs: [{ message: ['{broken-private-marker'] }] })]) {
    const input = stream(valid + (suffix === valid ? '' : '\n') + suffix);
    await assert.rejects(readWranglerTailSummary(input), code('invalid_log')); released(input);
  }
  for (const bytes of [[0xff], [0xe3, 0x81]]) {
    await assert.rejects(readWranglerTailSummary(Readable.from([Buffer.from(valid), Buffer.from(bytes)])), code('invalid_log'));
  }
});

test('no sampled app observations are unknown, not a healthy zero-response report', async () => {
  for (const text of ['', JSON.stringify({ logs: [] }), JSON.stringify(wrap([{ other: 'private-marker' }]))])
    await assert.rejects(readWranglerTailSummary(stream(text)), code('no_observations'));
  const report = await readWranglerTailSummary(stream(JSON.stringify(wrap([cleanup]))));
  assert.equal(report.observedResponses, 0); assert.equal(report.cleanup.observedRuns, 1);
  assert.equal(report.diagnostics.serviceHealth, 'unknown');
});

test('raw bytes, envelope/line size, physical lines and nesting depth are bounded', async () => {
  const padded = JSON.stringify({ logs: [], padding: 'x'.repeat(TAIL_LIMITS.envelopeBytes) });
  for (const text of [padded, ' '.repeat(TAIL_LIMITS.envelopeBytes + 1), '\n'.repeat(SUMMARY_LIMITS.lines + 1),
    '{"logs":[],"nested":' + '['.repeat(TAIL_LIMITS.depth) + '0' + ']'.repeat(TAIL_LIMITS.depth) + '}']) {
    const input = stream(text);
    await assert.rejects(readWranglerTailSummary(input), code('input_limit')); released(input);
  }
  await assert.rejects(readWranglerTailSummary(Readable.from([Buffer.alloc(SUMMARY_LIMITS.bytes + 1, 32)])), code('input_limit'));
  assert.equal((await readWranglerTailSummary(stream(JSON.stringify(wrap([{ other: 'x'.repeat(SUMMARY_LIMITS.lineBytes) }]))
    + '\n' + JSON.stringify(wrap([request]))))).observedResponses, 1);
  await assert.rejects(readWranglerTailSummary(stream(JSON.stringify(wrap([{ ...request, code: 'x'.repeat(SUMMARY_LIMITS.lineBytes) }])))), code('input_limit'));
});

test('conflicting duplicate app observations retain original rejection semantics', async () => {
  await assert.rejects(readWranglerTailSummary(stream(JSON.stringify(wrap([request,
    { ...request, latencyBucket: 'unknown' }])))), code('request_conflict'));
  await assert.rejects(readWranglerTailSummary(stream(JSON.stringify(wrap([cleanup,
    { ...cleanup, cursorAdvanced: false }])))), code('run_conflict'));
});

test('envelope count and ignored console count enforce budgets even without newlines', async () => {
  await assert.rejects(readWranglerTailSummary(stream('{"logs":[]} '.repeat(TAIL_LIMITS.envelopes + 1))), code('input_limit'));
  const envelope = JSON.stringify({ logs: Array.from({ length: 800 }, () => ({ message: ['ignored'] })) });
  await assert.rejects(readWranglerTailSummary(stream((envelope + ' ').repeat(63))), code('input_limit'));
  const valid = JSON.stringify(wrap([request]));
  assert.equal((await readWranglerTailSummary(stream('\n'.repeat(SUMMARY_LIMITS.lines - 1) + valid))).observedResponses, 1);
  await assert.rejects(readWranglerTailSummary(stream('\n'.repeat(SUMMARY_LIMITS.lines) + valid)), code('input_limit'));
});

test('tail mode deadline and stream failures stop reading, release listeners and hide error text', async () => {
  const idle = new PassThrough();
  await assert.rejects(readWranglerTailSummary(idle, 10), code('input_timeout')); released(idle);
  assert.equal(idle.destroyed, true);
  const broken = new PassThrough(); const result = readWranglerTailSummary(broken);
  broken.destroy(Error('private-stream-marker'));
  await assert.rejects(result, code('input_unavailable')); released(broken);
  for (const args of [['--wrangler-tail'], ['--stdin', '--wrangler-tail', '--wrangler-tail'], ['--wrangler-tail', '--stdin']])
    await assert.rejects(runObservationSummary(args, new PassThrough()), code('invalid_arguments'));
});

function cli(text: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../summarize-observations.ts', import.meta.url)), '--stdin', '--wrangler-tail'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('cli-test-timeout')); }, 5000);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.end(text);
  });
}
test('actual offline Node CLI prints one viewer-compatible JSON or a fixed private error, without partial output', async () => {
  const valid = JSON.stringify(wrap([request, cleanup]), null, 2);
  const passed = await cli(valid);
  assert.equal(passed.status, 0); assert.equal(passed.stderr, '');
  assert.equal(JSON.parse(passed.stdout).weightedRequestsEstimate, 64);
  assert.ok(parseObservationReport(JSON.parse(passed.stdout))); assert.ok(!passed.stdout.includes('private-'));
  const failed = await cli(valid + '\n' + JSON.stringify(wrap([{ ...request, secret: 'private-secret-marker' }])));
  assert.equal(failed.status, 1); assert.equal(failed.stdout, '');
  assert.deepEqual(JSON.parse(failed.stderr), { code: 'invalid_log' });
});
