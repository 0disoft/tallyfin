import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overviewDateChanged, parseOverviewPeriod, watchOverviewClock } from './overview-freshness.ts';
import { shiftDate, todayInZone } from './dates.ts';
const period = (generatedAt, timeZone) => {
  const to = todayInZone(timeZone, new Date(generatedAt));
  return { timeZone, from: shiftDate(to, -6), to, previousFrom: shiftDate(to, -13), previousTo: shiftDate(to, -7) };
};
test('period validation uses server time, handles year changes and never mutates frozen input', () => {
  const generatedAt = '2026-12-31T15:00:00.000Z', value = Object.freeze(period(generatedAt, 'Asia/Seoul'));
  assert.deepEqual(parseOverviewPeriod(value, generatedAt), value);
  assert.equal(value.to, '2027-01-01'); assert.equal(value.previousFrom, '2026-12-19');
  for (const mutate of [v => v.to = '2026-12-31', v => v.previousTo = v.from, v => v.from = '2026-02-30',
    v => v.timeZone = 'Invalid/Zone', v => v.private = 'secret', v => delete v.previousFrom]) {
    const next = { ...value }; mutate(next); assert.throws(() => parseOverviewPeriod(next, generatedAt));
  }
});
test('calendar rollover follows DST midnight instead of a fixed 24 hours and also checks UTC rejection dates', () => {
  for (const [generatedAt, midnight] of [['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']]) {
    // Omit generatedAt to isolate the project-local boundary from the UTC rejection boundary.
    const rows = [{ period: period(generatedAt, 'America/New_York') }], at = Date.parse(midnight);
    assert.equal(overviewDateChanged(rows, new Date(at - 1)), false);
    assert.equal(overviewDateChanged(rows, new Date(at)), true);
    assert.equal(overviewDateChanged(rows, new Date(at + 1)), true);
  }
  const generatedAt = '2026-10-23T23:59:59.999Z', rows = [{ generatedAt, period: period(generatedAt, 'America/Los_Angeles') }];
  assert.equal(overviewDateChanged(rows, new Date(generatedAt)), false);
  assert.equal(overviewDateChanged(rows, new Date('2026-10-24T00:00:00.000Z')), true);
});
test('clock checks suspend while hidden, resume on visibility/focus and remove timers/listeners on disposal', () => {
  const visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' }), focus = new EventTarget();
  let now = new Date('2026-10-23T14:59:59.999Z'), scheduled, timers = 0, ticks = [];
  const stop = watchOverviewClock(at => ticks.push(at.toISOString()), { visibility, focus, clock: () => now,
    everyMinute(callback) { timers++; scheduled = callback; return () => { timers--; scheduled = undefined; }; } });
  assert.equal(timers, 1); assert.equal(ticks.length, 1);
  now = new Date('2026-10-23T15:00:00.000Z'); scheduled(); assert.equal(ticks.at(-1), now.toISOString());
  visibility.visibilityState = 'hidden'; visibility.dispatchEvent(new Event('visibilitychange')); assert.equal(timers, 0);
  visibility.visibilityState = 'visible'; visibility.dispatchEvent(new Event('visibilitychange')); assert.equal(timers, 1);
  focus.dispatchEvent(new Event('focus')); const before = ticks.length;
  stop(); assert.equal(timers, 0); visibility.dispatchEvent(new Event('visibilitychange')); focus.dispatchEvent(new Event('focus'));
  assert.equal(ticks.length, before); assert.equal(timers, 0);
});
