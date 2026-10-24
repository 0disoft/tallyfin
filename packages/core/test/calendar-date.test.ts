import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateEnd, localDate, queryDates } from '../src/index.ts';

test('one formatter serves ingestion dates and query boundaries without caching date results', () => {
  const original = Intl.DateTimeFormat;
  let created = 0;
  Intl.DateTimeFormat = new Proxy(original, { construct(target, args) { created++; return Reflect.construct(target, args); } });
  try {
    const zone = 'Pacific/Chatham', at = Date.parse('2026-10-24T10:14:59.999Z');
    assert.equal(localDate(at, zone), '2026-10-24');
    assert.equal(localDate(at + 1, zone), '2026-10-25');
    for (let i = 0; i < 1000; i++) localDate(at + i, zone);
    assert.equal(dateEnd('2026-10-24', zone), at + 1);
    assert.deepEqual(queryDates('2026-10-25', '2026-10-25', zone, at + 1), ['2026-10-25']);
    assert.equal(created, 1);
  } finally { Intl.DateTimeFormat = original; }
});

test('local calendar boundaries preserve DST, half-hour shifts, skipped dates and year changes', () => {
  for (const [zone, date, end] of [
    ['America/New_York', '2026-03-08', '2026-03-09T04:00:00Z'],
    ['America/New_York', '2026-11-01', '2026-11-02T05:00:00Z'],
    ['Australia/Lord_Howe', '2026-10-04', '2026-10-04T13:00:00Z'],
    ['Pacific/Apia', '2011-12-30', '2011-12-30T10:00:00Z'],
    ['Asia/Seoul', '2024-02-29', '2024-02-29T15:00:00Z'],
    ['UTC', '2026-12-31', '2027-01-01T00:00:00Z'],
  ]) {
    assert.equal(dateEnd(date!, zone!), Date.parse(end!), `${zone} ${date}`);
  }
  const boundary = Date.parse('2026-03-08T07:00:00Z');
  assert.equal(localDate(boundary - 1, 'America/New_York'), '2026-03-08');
  assert.equal(localDate(boundary, 'America/New_York'), '2026-03-08');
  assert.equal(localDate(Date.parse('2026-07-01T04:00:00Z'), 'America/New_York'), '2026-07-01');
  assert.equal(localDate(Date.parse('2026-01-01T04:00:00Z'), 'America/New_York'), '2025-12-31');
});

test('formatter cache retains at most 32 zones, refreshes recency and rejects invalid zones without eviction', () => {
  const zones = Intl.supportedValuesOf('timeZone').slice(0, 40), at = Date.parse('2026-10-24T00:00:00Z');
  const expected = localDate(at, zones[9]!);
  for (const zone of zones) localDate(at, zone);
  const original = Intl.DateTimeFormat;
  let created = 0;
  Intl.DateTimeFormat = new Proxy(original, { construct(target, args) { created++; return Reflect.construct(target, args); } });
  try {
    assert.equal(localDate(at, zones[9]!), expected); assert.equal(created, 0);
    localDate(at, zones[0]!); assert.equal(created, 1); // Oldest (zone 8) is evicted; zone 9 stays recent.
    assert.equal(localDate(at, zones[9]!), expected); assert.equal(created, 1);
    assert.throws(() => localDate(at, 'Invalid/Zone'), RangeError);
    assert.throws(() => dateEnd('2026-10-24', 'Invalid/Zone'), RangeError);
    assert.equal(created, 3);
    localDate(at, zones[10]!); assert.equal(created, 3); // Failed constructions evict nothing.
    localDate(at, zones[8]!); assert.equal(created, 4);
  } finally { Intl.DateTimeFormat = original; }
});
