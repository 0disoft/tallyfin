import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareFailureReasons } from './failure-reason-comparison.ts';
import { analyticsCsv, CSV_COLUMNS } from './csv-export.ts';

const example = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
function fixture() {
  const registry = example('registry'); Object.assign(registry.workflows[0], { failureEvent: 'validation_error', failureReasonProperty: 'error' });
  const flow = (from, to, started, a, b, missing, unmeasured = 0) => {
    const response = example('workflow-response'), failed = a + b + missing + unmeasured;
    response.meta = { ...response.meta, from, to };
    response.summary = { startedAttempts: started, succeededAttempts: started - failed, failedAttempts: failed, pendingAttempts: 0, completionRate: started ? (started - failed) / started * 100 : null };
    response.failureReasons = { property: 'error', measuredFailures: a + b + missing, missingReasonFailures: missing, unmeasuredFailures: unmeasured,
      buckets: [{ value: 'range', failedAttempts: a }, { value: 'required', failedAttempts: b }] };
    response.days = [{ date: from, ...response.summary, failureReasons: structuredClone(response.failureReasons), provisional: false },
      { date: to, startedAttempts: 0, succeededAttempts: 0, failedAttempts: 0, pendingAttempts: 0, completionRate: null, provisional: false,
        failureReasons: { property: 'error', measuredFailures: 0, missingReasonFailures: 0, unmeasuredFailures: 0,
          buckets: [{ value: 'range', failedAttempts: 0 }, { value: 'required', failedAttempts: 0 }] } }];
    return { definition: registry.workflows[0], response };
  };
  const current = flow('2026-10-08', '2026-10-09', 10, 2, 1, 1), previous = flow('2026-10-06', '2026-10-07', 20, 2, 4, 2);
  const snapshot = load => ({ view: 'goals', range: { from: load.response.meta.from, to: load.response.meta.to }, workflows: [load],
    summary: { meta: load.response.meta, totalEvents: 0, events: registry.events.map(e => ({ name: e.name, count: 0 })) } });
  return { registry, current, previous, snapshot, flow };
}
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function records(text) {
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  const cells = line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""', '"'));
  assert.deepEqual(cells(lines.shift()), [...CSV_COLUMNS]);
  return lines.map(line => Object.fromEntries(CSV_COLUMNS.map((key, index) => [key, cells(line)[index]])));
}
test('reason composition changes independently of the overall failure rate and borrows frozen inputs', () => {
  const { registry, current, previous } = freeze(fixture());
  const result = compareFailureReasons(current, previous, registry);
  assert.equal(result.status, 'comparable'); assert.equal(result.currentFailureRate, 40); assert.equal(result.previousFailureRate, 40); assert.equal(result.failureRateChange, 0);
  assert.deepEqual(result.rows[0], { kind: 'enum', value: 'range', currentCount: 2, previousCount: 2, currentShare: 50, previousShare: 25, shareChange: 25 });
  assert.equal(result.rows[1].shareChange, -25); assert.equal(result.rows[2].kind, 'missing'); assert.equal(result.rows[2].shareChange, 0);
  assert.equal(result.rows[3].kind, 'unmeasured'); assert.equal(result.rows[3].shareChange, 0);
});
test('partial, entirely unmeasured and absent historical measurements never produce reason deltas or fake zeros', () => {
  const { registry, current, previous } = fixture();
  const reason = previous.response.failureReasons;
  reason.buckets[1].failedAttempts--; reason.measuredFailures--; reason.unmeasuredFailures++;
  previous.response.days[0].failureReasons = structuredClone(reason);
  let result = compareFailureReasons(current, previous, registry);
  assert.equal(result.status, 'incomplete_measurement'); assert.ok(result.rows.every(row => row.shareChange === null));
  assert.equal(result.rows[0].previousCount, 2); assert.equal(result.failureRateChange, 0);
  reason.buckets.forEach(b => { b.failedAttempts = 0; }); reason.measuredFailures = 0; reason.missingReasonFailures = 0; reason.unmeasuredFailures = 8;
  previous.response.days[0].failureReasons = structuredClone(reason);
  result = compareFailureReasons(current, previous, registry);
  assert.equal(result.rows[0].previousCount, null); assert.equal(result.rows[0].previousShare, null); assert.equal(result.rows[3].previousCount, 8);
  delete previous.response.failureReasons; previous.response.days.forEach(day => { delete day.failureReasons; });
  result = compareFailureReasons(current, previous, registry);
  assert.equal(result.status, 'unavailable'); assert.ok(result.rows.every(row => row.previousCount === null && row.shareChange === null));
});
test('zero failures and zero starts preserve different denominators; failureless and unconfigured schemas remain explicit', () => {
  const { registry, previous, flow } = fixture();
  let current = flow('2026-10-08', '2026-10-09', 10, 0, 0, 0);
  let result = compareFailureReasons(current, previous, registry);
  assert.equal(result.status, 'no_failed_attempts'); assert.equal(result.currentFailureRate, 0); assert.equal(result.failureRateChange, -40);
  assert.equal(result.rows[0].currentCount, 0); assert.equal(result.rows[0].currentShare, null); assert.equal(result.rows[0].shareChange, null);
  current = flow('2026-10-08', '2026-10-09', 0, 0, 0, 0);
  result = compareFailureReasons(current, previous, registry); assert.equal(result.currentFailureRate, null); assert.equal(result.failureRateChange, null);
  delete registry.workflows[0].failureReasonProperty;
  for (const load of [current, previous]) { load.response.failureReasons = null; load.response.days.forEach(day => { day.failureReasons = null; }); }
  result = compareFailureReasons(current, previous, registry); assert.equal(result.status, 'not_configured'); assert.deepEqual(result.rows, []);
  registry.workflows[0].failureEvent = null;
  for (const load of [current, previous]) {
    load.response.summary.failedAttempts = null; load.response.summary.succeededAttempts = load.response.summary.startedAttempts;
    load.response.summary.completionRate = load.response.summary.startedAttempts ? 100 : null;
    load.response.days.forEach((day, i) => { Object.assign(day, i === 0 ? load.response.summary : { failedAttempts: null }); });
  }
  assert.equal(compareFailureReasons(current, previous, registry).previousFailureRate, null);
});
test('comparison rejects stale tenants, dates, schemas, definitions and corrupt aggregates before export', () => {
  for (const edit of [f => f.previous.response.meta.projectId = 'other', f => f.previous.response.meta.schemaVersion++,
    f => f.previous.response.meta.from = '2026-10-05', f => f.previous.response.meta.timeZone = 'UTC',
    f => f.previous.response.workflowId = 'other', f => f.previous.response.failureReasons.buckets[0].failedAttempts++,
    f => f.previous.definition = { ...f.previous.definition, failureReasonProperty: 'tool' }]) {
    const f = fixture(); edit(f); assert.throws(() => compareFailureReasons(f.current, f.previous, f.registry));
    assert.throws(() => analyticsCsv({ registry: f.registry, current: f.snapshot(f.current), previous: f.snapshot(f.previous), view: 'goals' }));
  }
});
test('CSV uses the shared comparisons, appends columns, and records provisional and measurement-blocked deltas', () => {
  const { registry, current, previous, snapshot } = fixture();
  const csv = () => records(analyticsCsv({ registry, current: snapshot(current), previous: snapshot(previous), view: 'goals' }).text);
  current.response.days[0].provisional = true;
  let rows = csv(), reason = rows.find(row => row.record_type === 'workflow_failure_reason_comparison' && row.failure_reason === 'range');
  assert.deepEqual([reason.count, reason.previous_count, reason.share_percent, reason.previous_share_percent, reason.change, reason.change_unit], ['2', '2', '50', '25', '25', 'percentage_point']);
  assert.equal(reason.provisional, 'true'); assert.equal(reason.failure_reason_comparison_status, 'comparable');
  const rate = rows.find(row => row.record_type === 'workflow_failure_rate_comparison');
  assert.equal(rate.share_percent, '40'); assert.equal(rate.previous_share_percent, '40'); assert.equal(rate.change, '0');
  previous.response.failureReasons.unmeasuredFailures++; previous.response.failureReasons.measuredFailures--; previous.response.failureReasons.missingReasonFailures--;
  previous.response.days[0].failureReasons = structuredClone(previous.response.failureReasons);
  rows = csv(); reason = rows.find(row => row.record_type === 'workflow_failure_reason_comparison' && row.failure_reason === 'range');
  assert.equal(reason.change, ''); assert.equal(reason.previous_count, '2'); assert.equal(reason.availability, 'incomplete_measurement');
});
test('actual comparison view renders shared rates, blocked changes, loading and failed prior loads', async () => {
  const require = createRequire(import.meta.url);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../WorkflowFailureReasonComparison.tsx', import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'node', jsx: 'automatic', plugins: [{ name: 'shared-react', setup(build) {
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    } }] });
  const { default: View } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const f = fixture(), props = { ...f, status: 'ready' };
  const render = changes => renderToStaticMarkup(createElement(View, { ...props, ...changes }));
  let html = render(); assert.match(html, /전체 실패율/); assert.match(html, /40.0%/); assert.match(html, /\+25.0%p/);
  assert.match(html, /10/); assert.match(html, /20/); assert.match(html, /원인 누락/);
  assert.doesNotMatch(render({ status: 'loading' }), /<table/); assert.match(render({ status: 'loading' }), /조회하는 중/);
  assert.doesNotMatch(render({ status: 'error' }), /<table/); assert.match(render({ status: 'error' }), /비교 다시 시도/);
  assert.match(render({ previous: undefined }), /직전 기간을 읽지 못해/);
  f.previous.response.failureReasons.unmeasuredFailures++; f.previous.response.failureReasons.measuredFailures--; f.previous.response.failureReasons.missingReasonFailures--;
  f.previous.response.days[0].failureReasons = structuredClone(f.previous.response.failureReasons);
  f.current.response.days[0].provisional = true;
  html = render(); assert.match(html, /원인 변화 비교를 보류/); assert.match(html, /집계 중인 시작일/); assert.doesNotMatch(html, /\+25.0%p/);
});
