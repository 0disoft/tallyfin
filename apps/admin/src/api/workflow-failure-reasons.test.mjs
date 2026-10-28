import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { i18nViewPlugin, renderWithLocale as renderToStaticMarkup } from '../../tests/i18n-fixture.mjs';
import { parseRegistry, parseWorkflowResponse } from './validate.ts';
import { failureReasonAvailability, parseFailureReasons } from './workflow-failure-reasons.ts';
import { analyticsCsv, CSV_COLUMNS } from './csv-export.ts';
import { previousRange, validateWorkflowLoad } from './period-comparison.ts';
import { changeWorkflowForm, readWorkflowForm, workflowFailureReasonChoices, workflowIssueTarget, workflowWarnings } from './schema-workflow-form.ts';
import { parseSchemaValidation } from './schema-contract.ts';

const example = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
const reasons = (a = 1, b = 0, missing = 1, old = 2) => ({ property: 'error', measuredFailures: a + b + missing, missingReasonFailures: missing, unmeasuredFailures: old,
  buckets: [{ value: 'range', failedAttempts: a }, { value: 'required', failedAttempts: b }] });
const registry = () => {
  const r = example('registry'); Object.assign(r.workflows[0], { failureEvent: 'validation_error', failureReasonProperty: 'error' }); return r;
};
const response = () => {
  const value = example('workflow-response'); value.failureReasons = reasons();
  Object.assign(value.summary, { startedAttempts: 5, failedAttempts: 4, completionRate: 20 });
  Object.assign(value.days[0], value.summary, { failureReasons: reasons() });
  Object.assign(value.days[1], { failedAttempts: 0, failureReasons: reasons(0, 0, 0, 0) }); return value;
};
function snapshot(flow = response(), r = registry()) {
  const summary = { meta: flow.meta, totalEvents: 0, events: r.events.map(e => ({ name: e.name, count: 0 })) };
  return { view: 'goals', summary, range: { from: flow.meta.from, to: flow.meta.to }, workflows: [{ definition: r.workflows[0], response: flow }] };
}
function rows(text) {
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  const cells = line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""', '"'));
  assert.deepEqual(cells(lines.shift()), [...CSV_COLUMNS]);
  return lines.map(line => Object.fromEntries(CSV_COLUMNS.map((key, i) => [key, cells(line)[i]])));
}
test('failure reasons preserve old omitted fields, null, missing and historical coverage', () => {
  assert.deepEqual(parseWorkflowResponse(response()), response());
  assert.equal(parseWorkflowResponse(example('workflow-response')).failureReasons, undefined);
  const unset = example('workflow-response'); unset.failureReasons = null; unset.days.forEach(day => { day.failureReasons = null; });
  assert.equal(parseWorkflowResponse(unset).failureReasons, null);
  assert.equal(failureReasonAvailability(undefined), 'unavailable'); assert.equal(failureReasonAvailability(null), 'not_configured');
  assert.equal(failureReasonAvailability(reasons()), 'partial'); assert.equal(failureReasonAvailability(reasons(0, 0, 0, 2)), 'unmeasured');
  assert.equal(failureReasonAvailability(reasons(0, 0, 0, 0)), 'no_failed_attempts');
  assert.equal(parseRegistry(registry()).workflows[0].failureReasonProperty, 'error');
});
test('parser, snapshots and CSV reject duplicate reasons, inconsistent coverage, unknown values and daily drift', () => {
  for (const edit of [v => delete v.failureReasons, v => delete v.days[0].failureReasons, v => v.failureReasons = null,
    v => v.failureReasons.buckets.reverse(), v => v.failureReasons.buckets[1].value = 'range',
    v => v.failureReasons.buckets[0].failedAttempts = -1, v => v.failureReasons.measuredFailures++,
    v => v.failureReasons.missingReasonFailures++, v => v.failureReasons.unmeasuredFailures++,
    v => v.failureReasons.buckets[0].message = 'private', v => v.failureReasons.extra = 1,
    v => { v.days[0].failureReasons.buckets[0].failedAttempts = 0; v.days[0].failureReasons.buckets[1].failedAttempts = 1; }]) {
    const value = response(); edit(value);
    assert.throws(() => parseWorkflowResponse(value)); assert.throws(() => analyticsCsv({ registry: registry(), current: snapshot(value), view: 'goals' }));
  }
  for (const edit of [v => { v.failureReasons.property = 'other'; v.days[0].failureReasons.property = 'other'; v.days[1].failureReasons.property = 'other'; },
    v => { for (const reason of [v.failureReasons, ...v.days.map(d => d.failureReasons)]) reason.buckets[0].value = 'foreign'; }]) {
    const value = response(); edit(value); parseWorkflowResponse(value);
    assert.throws(() => validateWorkflowLoad(snapshot(value).workflows[0], registry(), snapshot(value).range));
  }
  assert.throws(() => parseFailureReasons(reasons(Number.MAX_SAFE_INTEGER), { failedAttempts: Number.MAX_SAFE_INTEGER }));
  const r = registry(); r.workflows[0].failureReasonProperty = 'missing'; assert.throws(() => parseRegistry(r));
});
test('CSV appends columns and uses all confirmed failures as the denominator, including missing and unmeasured', () => {
  const flow = response(), data = snapshot(flow);
  const exported = rows(analyticsCsv({ registry: registry(), current: data, view: 'goals' }).text);
  const total = exported.filter(row => row.record_type === 'workflow_failure_reason_total');
  assert.deepEqual(total.map(row => [row.metric, row.failure_reason, row.count, row.share_percent]),
    [['enum', 'range', '1', '25'], ['enum', 'required', '0', '0'], ['missing', '', '1', '25'], ['unmeasured', '', '2', '50']]);
  assert.ok(total.every(row => row.failure_reason_measured_failures === '2' && row.failure_reason_missing_failures === '1' && row.failure_reason_unmeasured_failures === '2' && row.availability === 'partial'));
  assert.equal(exported.filter(row => row.record_type === 'workflow_failure_reason_day').length, 8);
  const previous = structuredClone(data); previous.range = previousRange(data.range);
  previous.summary.meta = { ...previous.summary.meta, ...previous.range };
  const priorFlow = previous.workflows[0].response; priorFlow.meta = previous.summary.meta;
  priorFlow.failureReasons = reasons(0, 0, 0, 4);
  priorFlow.days.forEach((day, index) => {
    day.date = index === 0 ? previous.range.from : previous.range.to;
    day.failureReasons = reasons(0, 0, 0, index === 0 ? 4 : 0);
  });
  const compared = rows(analyticsCsv({ registry: registry(), current: data, previous, view: 'goals' }).text);
  assert.equal(compared.find(row => row.period === 'current' && row.record_type === 'workflow_failure_reason_total' && row.failure_reason === 'range').share_percent, '25');
  assert.ok(compared.filter(row => row.period === 'previous' && row.record_type === 'workflow_failure_reason_total' && row.metric === 'enum')
    .every(row => row.availability === 'unmeasured' && row.count === '' && row.share_percent === ''));
  flow.failureReasons = reasons(0, 0, 0, 4); flow.days[0].failureReasons = reasons(0, 0, 0, 4);
  const old = rows(analyticsCsv({ registry: registry(), current: data, view: 'goals' }).text);
  assert.ok(old.filter(row => row.record_type === 'workflow_failure_reason_total' && row.metric === 'enum').every(row => row.count === '' && row.share_percent === ''));
  delete flow.failureReasons; flow.days.forEach(day => { delete day.failureReasons; });
  assert.ok(rows(analyticsCsv({ registry: registry(), current: data, view: 'goals' }).text).filter(row => row.record_type === 'workflow_total').every(row => row.failure_reason_measured_failures === '' && row.failure_reason_availability === 'unavailable'));
});
test('schema form selects only failure enum properties, clears optional fields and focuses semantic issues', () => {
  const r = registry(), original = JSON.stringify({ events: r.events, workflows: r.workflows });
  assert.deepEqual(workflowFailureReasonChoices(readWorkflowForm(original), 0), ['tool', 'error']);
  const unset = changeWorkflowForm(original, { kind: 'failureReason', index: 0, value: '' });
  assert.equal(Object.hasOwn(JSON.parse(unset).workflows[0], 'failureReasonProperty'), false);
  assert.equal(JSON.parse(changeWorkflowForm(unset, { kind: 'failureReason', index: 0, value: 'error' })).workflows[0].failureReasonProperty, 'error');
  assert.throws(() => changeWorkflowForm(unset, { kind: 'failureReason', index: 0, value: 'unknown' }));
  const broken = changeWorkflowForm(original, { kind: 'edit', index: 0, field: 'failureEvent', value: null });
  assert.ok(workflowWarnings(readWorkflowForm(broken), 0).some(w => w.field === 'failureReasonProperty'));
  const report = parseSchemaValidation({ valid: false, issues: [{ path: '/workflows/0/failureReasonProperty', code: 'invalid_reference' }], privacyReviewRequired: true });
  assert.equal(workflowIssueTarget(broken, report.issues[0]), 'schema-workflow-0-failureReasonProperty');
  assert.equal(JSON.parse(original).workflows[0].failureReasonProperty, 'error');
});
test('actual failure reason component renders partial, missing, disabled, absent and zero states', async () => {
  const require = createRequire(import.meta.url);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../WorkflowFailureReasons.tsx', import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'node', jsx: 'automatic', plugins: [i18nViewPlugin, { name: 'shared-react', setup(build) {
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    } }] });
  const { default: View } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const render = (value, failed = 4, definition = registry().workflows[0]) => renderToStaticMarkup(createElement(View, { reasons: value, failed, definition, provisional: true }));
  const html = render(reasons()); assert.match(html, /25.0%/); assert.match(html, /원인 누락 1건 · 미측정 실패 2건/); assert.match(html, /집계 중/);
  assert.match(render(undefined), /측정 정보가 없어요/); assert.match(render(null, null, example('registry').workflows[0]), /실패 이벤트가 없는/);
  const unset = registry().workflows[0]; delete unset.failureReasonProperty; assert.match(render(null, 4, unset), /enum 속성을 선택/);
  assert.match(render(reasons(0, 0, 0, 0), 0), /확정 실패가 없어요/);
  assert.doesNotMatch(render(reasons(0, 0, 0, 4)), /<table/);
});
