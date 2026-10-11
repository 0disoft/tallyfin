import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareFunnelBreakdowns, funnelValueKey } from './funnel-breakdown-comparison.ts';
import { funnelCsv } from './funnel-csv.ts';

const fixture = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
const current = () => fixture('funnel-breakdown-response');
function before(body) {
  const value = structuredClone(body);
  value.meta.from = '2026-10-06'; value.meta.to = '2026-10-07';
  const days = value.buckets ? value.buckets.flatMap(bucket => bucket.days) : value.days;
  days.forEach(day => { day.date = day.date === '2026-10-08' ? '2026-10-06' : '2026-10-07'; day.provisional = false; });
  return value;
}
function zero(value) {
  value.buckets = [];
  value.summary = { startedRuns: 0, completedRuns: 0, completionRate: null,
    steps: value.definition.steps.map((_, index, steps) => ({ stepIndex: index, reachedRuns: 0, reachRate: null, conversionRate: null, notReachedNext: index < steps.length - 1 ? 0 : null })) };
  return value;
}
const cells = line => line.split(',').map(value => value.replace(/^"|"$/g, '').replaceAll('""', '"'));
function csvRows(text) {
  const [columns, ...rows] = text.slice(1).trimEnd().split('\r\n').map(cells);
  assert.ok(rows.every(row => row.length === columns.length));
  return rows.map(row => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

test('group comparison includes current-only and previous-only values with 0 counts, unknown rates and no previous-zero growth', () => {
  const now = current(), previous = before(now);
  previous.buckets[0].value = 'text';
  const rows = compareFunnelBreakdowns(now, previous);
  assert.deepEqual(rows.map(bucket => bucket.value), ['image', 'pdf', 'text']);
  const image = rows[0], pdf = rows[1], text = rows[2];
  assert.equal(image.previous.startedRuns, 0); assert.equal(image.previous.completionRate, null);
  assert.equal(image.rows.find(row => row.key === 'started').change, null);
  assert.equal(image.rows.find(row => row.key === 'completion').change, null);
  assert.equal(text.current.startedRuns, 0); assert.equal(text.rows.find(row => row.key === 'started').change, -100);
  assert.equal(text.rows.find(row => row.key === 'completion').change, null);
  assert.equal(pdf.rows.find(row => row.key === 'completion').change, 0);
  assert.equal(pdf.rows.find(row => row.key === 'step:1:conversion').change, 0);
  assert.equal(pdf.rows.length, 15);
});

test('empty periods do not invent a value and typed false/zero/string buckets stay distinct', () => {
  assert.deepEqual(compareFunnelBreakdowns(zero(current()), zero(before(current()))), []);
  const now = current(), previous = before(now);
  now.buckets[0].value = false; now.buckets[1].value = 0;
  previous.buckets[0].value = 'false'; previous.buckets[1].value = '0';
  assert.deepEqual(compareFunnelBreakdowns(now, previous).map(bucket => bucket.value), [false, 0, 'false', '0']);
  assert.notEqual(funnelValueKey(0), funnelValueKey('0'));
  assert.notEqual(funnelValueKey(false), funnelValueKey('false'));
  assert.equal(compareFunnelBreakdowns(now, zero(before(now))).length, 2);
});

test('group comparison refuses mismatched scope, dimension, period, schema and corrupted counts', () => {
  const now = current();
  for (const mutate of [v => v.meta.projectId = 'other', v => v.meta.schemaVersion++,
    v => v.meta.timeZone = 'UTC', v => v.definition.label = 'Other', v => v.funnelId = v.definition.id = 'other',
    v => { v.definition.dimensions = ['other']; v.groupBy = 'other'; },
    v => v.buckets[0].summary.startedRuns++, v => v.summary.completedRuns++,
    v => v.buckets[0].days.reverse()]) {
    const value = before(now); mutate(value);
    assert.throws(() => compareFunnelBreakdowns(now, value));
  }
  assert.throws(() => compareFunnelBreakdowns(now, now));
});

test('CSV includes actual days for both periods and typed union comparison without fictitious daily buckets', () => {
  const now = current(), previous = before(now); previous.buckets[0].value = 'text';
  const whole = fixture('funnel-response'), rows = csvRows(funnelCsv(whole, before(whole), now, previous));
  const previousRows = rows.filter(row => row.row_type === 'property_daily' && row.period === 'previous');
  assert.equal(previousRows.length, 16);
  assert.ok(previousRows.every(row => ['2026-10-06', '2026-10-07'].includes(row.date)));
  assert.ok(previousRows.every(row => row.from === previous.meta.from && row.generated_at === previous.meta.generatedAt));
  const text = rows.find(row => row.row_type === 'property_comparison' && row.property_value === 'text' && row.metric === 'started');
  assert.equal(text.current_value, '0'); assert.equal(text.previous_value, '1'); assert.equal(text.change, '-100');
  assert.equal(text.group_by, 'kind'); assert.equal(text.property_type, 'string');
  assert.equal(rows.some(row => row.property_value === 'text' && row.period === 'current' && row.row_type === 'property_daily'), false);
  assert.equal(rows.filter(row => row.row_type === 'property_comparison').length, 45);
  assert.throws(() => funnelCsv(whole, undefined, now, previous));
  assert.throws(() => funnelCsv(whole, before(whole), undefined, previous));
  assert.throws(() => funnelCsv(whole, before(whole), now, now));
  for (const primitive of [false, 0]) {
    const typed = current(); typed.buckets[0].value = primitive;
    const row = csvRows(funnelCsv(whole, before(whole), typed, before(typed))).find(row => row.row_type === 'property_comparison' && row.property_value === String(primitive));
    assert.equal(row.property_type, typeof primitive);
  }
});
