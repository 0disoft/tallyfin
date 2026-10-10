import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonRangeError, rangeError, shiftDate, todayInZone } from './dates.ts';
import { queryDates } from '../../../../packages/core/src/query.ts';
import { previousRange } from './period-comparison.ts';

test('custom inclusive dates match the backend 31-day and 90-day boundaries without changing the contract', () => {
  const at = Date.parse('2026-10-08T15:30:00Z'), today = todayInZone('Asia/Seoul', new Date(at));
  assert.equal(today, '2026-10-09');
  for (const range of [
    { from: today, to: today }, { from: shiftDate(today, -30), to: today },
    { from: shiftDate(today, -89), to: shiftDate(today, -89) },
    { from: shiftDate(today, -89), to: shiftDate(today, -59) },
  ]) {
    assert.equal(rangeError(range, today), null);
    assert.doesNotThrow(() => queryDates(range.from, range.to, 'Asia/Seoul', at));
  }
  for (const range of [
    { from: '', to: today }, { from: '2026-02-30', to: today }, { from: '2026-2-01', to: today },
    { from: today, to: shiftDate(today, -1) }, { from: today, to: shiftDate(today, 1) },
    { from: shiftDate(today, -31), to: today }, { from: shiftDate(today, -90), to: today },
  ]) {
    assert.ok(rangeError(range, today));
    assert.throws(() => queryDates(range.from, range.to, 'Asia/Seoul', at));
  }
});

test('leap days, year boundaries and DST remain calendar dates in the project time zone', () => {
  assert.equal(rangeError({ from: '2028-02-29', to: '2028-03-01' }, '2028-03-01'), null);
  assert.ok(rangeError({ from: '2027-02-29', to: '2027-03-01' }, '2027-03-01'));
  assert.equal(rangeError({ from: '2026-12-31', to: '2027-01-01' }, '2027-01-01'), null);
  const spring = todayInZone('America/New_York', new Date('2026-03-09T03:30:00Z'));
  assert.equal(spring, '2026-03-08');
  const range = { from: '2026-03-01', to: spring };
  assert.equal(rangeError(range, spring), null);
  assert.deepEqual(previousRange(range), { from: '2026-02-21', to: '2026-02-28' });
});

test('previous-window retention guard permits the exact boundary and rejects expired comparison independently', () => {
  const today = '2026-10-09';
  assert.equal(comparisonRangeError({ from: shiftDate(today, -44), to: shiftDate(today, -44) }, today), null);
  assert.equal(comparisonRangeError({ from: shiftDate(today, -88), to: shiftDate(today, -88) }, today), null);
  const range = { from: shiftDate(today, -89), to: shiftDate(today, -89) };
  assert.equal(rangeError(range, today), null);
  assert.ok(comparisonRangeError(range, today));
  assert.ok(comparisonRangeError({ from: '', to: today }, today));
});
