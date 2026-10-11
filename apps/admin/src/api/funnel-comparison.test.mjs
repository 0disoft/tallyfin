import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareFunnels } from './funnel-comparison.ts';
import { funnelCsv, FUNNEL_CSV_COLUMNS } from './funnel-csv.ts';
import { parseFunnelResponse } from './funnel-contract.ts';
import { shiftDate } from './dates.ts';

const fixture = () => JSON.parse(readFileSync(new URL('../../../../api/examples/funnel-response.json', import.meta.url), 'utf8'));
function counts(reached) {
  const start = reached[0], end = reached.at(-1);
  return { startedRuns: start, completedRuns: end, completionRate: start ? end / start * 100 : null,
    steps: reached.map((count, index) => ({ stepIndex: index, reachedRuns: count, reachRate: start ? count / start * 100 : null,
      conversionRate: index && reached[index - 1] ? count / reached[index - 1] * 100 : null,
      notReachedNext: index < reached.length - 1 ? count - reached[index + 1] : null })) };
}
function before() {
  const result = fixture();
  result.meta.from = shiftDate(result.meta.from, -2); result.meta.to = shiftDate(result.meta.to, -2);
  result.meta.generatedAt = '2026-10-11T04:00:00.000Z';
  result.days = result.days.map(day => ({ date: shiftDate(day.date, -2), provisional: false, ...counts([20, 15, 10, 5]) }));
  result.summary = counts([40, 30, 20, 10]);
  return result;
}

test('same-definition adjacent cohorts compare counts by %, completion and step rates by percentage points', () => {
  const rows = compareFunnels(fixture(), before());
  assert.deepEqual(rows[0], { key: 'started', label: '시작 실행', stepIndex: null, current: 20, previous: 40, change: -50, unit: '%', rate: false });
  assert.equal(rows.find(row => row.key === 'completed').change, -40);
  assert.equal(rows.find(row => row.key === 'completion').change, 5);
  assert.equal(rows.find(row => row.key === 'step:1:reach-rate').change, -10);
  assert.equal(rows.find(row => row.key === 'step:0:conversion').change, null);
  assert.equal(rows.length, 15);
});

test('zero starts and no previous counts keep undefined rates/relative changes null', () => {
  const previous = before();
  previous.summary = counts([0, 0, 0, 0]);
  previous.days = previous.days.map(day => ({ date: day.date, provisional: day.provisional, ...counts([0, 0, 0, 0]) }));
  const rows = compareFunnels(fixture(), previous);
  assert.ok(rows.every(row => row.change === null));
  assert.equal(rows[0].previous, 0); assert.equal(rows[2].previous, null);
});

test('mismatched project, version, time zone, definition, period and invalid counts refuse comparison and CSV', () => {
  for (const mutate of [r => r.meta.projectId = 'other', r => r.meta.schemaVersion++, r => r.meta.timeZone = 'UTC',
    r => r.definition.label = 'changed', r => r.definition.steps[0].source = 'server', r => r.definition.dimensions = [],
    r => { r.meta.from = '2026-10-07'; r.meta.to = '2026-10-08'; r.days.forEach(day => { day.date = shiftDate(day.date, 1); }); },
    r => r.summary.completedRuns++, r => r.summary.steps[1].reachRate = 99]) {
    const previous = before(); mutate(previous);
    assert.throws(() => compareFunnels(fixture(), previous));
    assert.throws(() => funnelCsv(fixture(), previous));
  }
});

test('comparison CSV keeps current/previous clocks and periods distinct and exports the same derived metrics', () => {
  const current = fixture(), previous = before(), csv = funnelCsv(current, previous);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  const cells = line => line.split(',').map(value => value.replace(/^"|"$/g, '').replaceAll('""', '"'));
  const columns = cells(lines[0]), rows = lines.slice(1).map(cells);
  assert.ok(rows.every(row => row.length === columns.length));
  const value = (row, key) => row[columns.indexOf(key)];
  assert.equal(rows.filter(row => value(row, 'period') === 'current').length, 12);
  assert.equal(rows.filter(row => value(row, 'period') === 'previous').length, 12);
  assert.equal(rows.filter(row => value(row, 'row_type') === 'comparison').length, 15);
  const old = rows.find(row => value(row, 'period') === 'previous');
  assert.equal(value(old, 'from'), previous.meta.from); assert.equal(value(old, 'generated_at'), previous.meta.generatedAt);
  const delta = rows.find(row => value(row, 'metric') === 'completion');
  assert.equal(value(delta, 'current_value'), '30'); assert.equal(value(delta, 'previous_value'), '25');
  assert.equal(value(delta, 'change'), '5'); assert.equal(value(delta, 'change_unit'), '%p');
  const edge = rows.find(row => value(row, 'metric') === 'step:0:conversion');
  assert.equal(value(edge, 'change'), '');
  assert.deepEqual(cells(funnelCsv(current).slice(1).split('\r\n')[0]), [...FUNNEL_CSV_COLUMNS]);
  assert.ok(parseFunnelResponse(current));
});
