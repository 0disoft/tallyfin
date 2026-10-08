import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projects, getRecords, getSeries, summarize, periodLabel } from './data.ts';

test('reference week has accurate totals and completion denominator', () => {
  const project = projects[0], days = getRecords(project, 7), summary = summarize(project, days);
  assert.deepEqual([summary.total, summary.started, summary.succeeded, summary.failed, summary.rate], [24680, 4800, 4128, 96, 86]);
  assert.equal(getSeries(days).reduce((sum, day) => sum + day.count, 0), summary.total);
  assert.equal(summary.events[3].count, 3560);
});
test('every project and period has nonnegative isolated counts and consistent chart totals', () => {
  for (const project of projects) for (const period of [7, 14, 30]) {
    const records = getRecords(project, period), summary = summarize(project, records);
    assert.equal(records.length, period);
    assert.equal(records.at(-1).date, '2026-10-08');
    assert.equal(getSeries(records).reduce((sum, day) => sum + day.count, 0), summary.total);
    for (const day of records) { assert.deepEqual(Object.keys(day.events), project.events.map(event => event.name)); for (const count of Object.values(day.events)) assert.ok(Number.isInteger(count) && count >= 0); }
    assert.ok(summary.succeeded <= summary.started);
  }
});
test('empty data is unknown completion, not zero percent', () => {
  const summary = summarize(projects[0], []);
  assert.equal(summary.total, 0);
  assert.equal(summary.rate, null);
});

test('overlapping dates retain their counts when changing the period', () => {
  for (const project of projects) {
    const month = getRecords(project, 30);
    for (const period of [7, 14]) assert.deepEqual(getRecords(project, period), month.slice(-period));
  }
});
test('period labels share the fixture calendar and widen correctly', () => {
  assert.equal(periodLabel(7), '2026.10.02 – 10.08');
  assert.equal(periodLabel(30), '2026.09.09 – 10.08');
});
