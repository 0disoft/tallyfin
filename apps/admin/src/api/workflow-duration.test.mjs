import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseWorkflowResponse } from './validate.ts';
import { DURATION_RANGES, durationAvailability, parseWorkflowDuration, validateWorkflowDurations } from './workflow-duration.ts';
import { analyticsCsv, CSV_COLUMNS } from './csv-export.ts';
import { previousRange, validateWorkflowLoad } from './period-comparison.ts';

const example = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
const duration = (success = 1, unmeasured = 0, failed = null) => ({ measuredAttempts: success + (failed ?? 0), unmeasuredAttempts: unmeasured,
  buckets: DURATION_RANGES.map(([range], i) => ({ range, succeededAttempts: i === 2 ? success : 0, failedAttempts: failed === null ? null : i === 1 ? failed : 0 })) });
const response = () => {
  const value = example('workflow-response');
  value.duration = duration();
  value.days.forEach((day, i) => { day.duration = duration(i === 0 ? 1 : 0); });
  return value;
};
const rows = text => {
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  const cells = line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"'));
  assert.deepEqual(cells(lines.shift()), [...CSV_COLUMNS]);
  return lines.map(line => Object.fromEntries(CSV_COLUMNS.map((key, i) => [key, cells(line)[i]])));
};

test('parser retains optional duration distributions and old responses without inventing measurements', () => {
  const value = response(); Object.freeze(value.duration.buckets);
  assert.deepEqual(parseWorkflowResponse(value), value);
  const old = parseWorkflowResponse(example('workflow-response'));
  assert.equal(old.duration, undefined); assert.ok(old.days.every(day => day.duration === undefined));
  assert.equal(durationAvailability(undefined), 'unavailable');
  assert.equal(durationAvailability(duration(0, 1)), 'unmeasured');
  assert.equal(durationAvailability(duration(0)), 'no_completed_attempts');
  assert.equal(durationAvailability(duration(1, 1)), 'partial');
});

test('parser and CSV validation reject contradictory counts, sparse measurement coverage and per-day bucket mismatches', () => {
  for (const edit of [
    v => delete v.days[0].duration, v => delete v.duration,
    v => v.duration.buckets.reverse(), v => v.duration.buckets.pop(),
    v => v.duration.buckets[0].succeededAttempts = -1,
    v => v.duration.buckets[0].failedAttempts = 0,
    v => v.duration.measuredAttempts++, v => v.duration.unmeasuredAttempts++,
    v => v.duration.buckets[2].extra = 1, v => v.duration.extra = 1,
    v => { v.days[0].duration.buckets[2].succeededAttempts = 0; v.days[0].duration.buckets[1].succeededAttempts = 1; },
  ]) {
    const value = response(); edit(value);
    assert.throws(() => parseWorkflowResponse(value)); assert.throws(() => validateWorkflowDurations(value));
  }
  assert.throws(() => parseWorkflowDuration(duration(Number.MAX_SAFE_INTEGER, 1), { succeededAttempts: Number.MAX_SAFE_INTEGER, failedAttempts: null }));
  const both = duration(2, 1, 1);
  assert.deepEqual(parseWorkflowDuration(both, { succeededAttempts: 3, failedAttempts: 1 }), both);
});

test('CSV preserves measured-only shares, raw ranges, failureless null and per-day measurement coverage', () => {
  const registry = example('registry'), flow = response(), summary = example('summary-response');
  summary.meta = flow.meta; summary.events = registry.events.map(event => ({ name: event.name, count: 0 })); summary.totalEvents = 0;
  const snapshot = { view: 'goals', summary, range: { from: flow.meta.from, to: flow.meta.to }, workflows: [{ definition: registry.workflows[0], response: flow }] };
  validateWorkflowLoad(snapshot.workflows[0], registry, snapshot.range);
  const result = rows(analyticsCsv({ registry, current: snapshot, view: 'goals' }).text);
  const bucket = result.find(row => row.record_type === 'workflow_duration_total' && row.duration_range === '5s_to_30s');
  assert.equal(bucket.count, '1'); assert.equal(bucket.share_percent, '100'); assert.equal(bucket.failed_attempts, '');
  assert.equal(bucket.duration_measured_attempts, '1'); assert.equal(bucket.duration_unmeasured_attempts, '0');
  assert.equal(result.filter(row => row.record_type === 'workflow_duration_day').length, 12);
  const previous = structuredClone(snapshot); previous.range = previousRange(snapshot.range);
  previous.summary.meta = { ...previous.summary.meta, ...previous.range };
  const prior = previous.workflows[0].response; prior.meta = previous.summary.meta; prior.duration = duration(0, 1);
  prior.days.forEach((day, index) => { day.date = index === 0 ? previous.range.from : previous.range.to; day.duration = duration(0, index === 0 ? 1 : 0); });
  const compared = rows(analyticsCsv({ registry, current: snapshot, previous, view: 'goals' }).text);
  assert.equal(compared.find(row => row.period === 'current' && row.record_type === 'workflow_duration_total' && row.duration_range === '5s_to_30s').share_percent, '100');
  assert.ok(compared.filter(row => row.period === 'previous' && row.record_type === 'workflow_duration_total')
    .every(row => row.availability === 'unmeasured' && row.count === '' && row.share_percent === ''));
  flow.duration = duration(0, 1); flow.days[0].duration = duration(0, 1);
  const legacy = rows(analyticsCsv({ registry, current: snapshot, view: 'goals' }).text);
  const unavailable = legacy.find(row => row.record_type === 'workflow_duration_total');
  assert.equal(unavailable.availability, 'unmeasured'); assert.equal(unavailable.count, ''); assert.equal(unavailable.share_percent, '');
  flow.duration.unmeasuredAttempts++;
  assert.throws(() => analyticsCsv({ registry, current: snapshot, view: 'goals' }));
});

test('actual duration component renders partial and absent measurements without fabricated percentages', async () => {
  const require = createRequire(import.meta.url);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../WorkflowDuration.tsx', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    plugins: [{ name: 'shared-react', setup(build) {
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    } }],
  });
  const { default: View } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const render = value => renderToStaticMarkup(createElement(View, { duration: value, provisional: true }));
  const partial = render(duration(2, 3, 1));
  assert.match(partial, /측정 3건 · 미측정 완료 3건/); assert.match(partial, /66.7%/); assert.match(partial, /집계 중/);
  assert.match(render(undefined), /측정 정보가 없어요/);
  const unmeasured = render(duration(0, 2));
  assert.match(unmeasured, /소요시간은 미측정/); assert.doesNotMatch(unmeasured, /<table/);
  assert.match(render(duration(0)), /완료 시도가 없어요/);
});
