import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dimensionKey, validateRegistry, DAY } from '@tallyfin/core';
import { funnelBreakdown, FUNNEL_DIMENSION_ROW_LIMIT } from '../src/funnel-breakdown.ts';

function fixture() {
  const value = JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
  value.events = Array.from({ length: 10 }, (_, index) => ({ name: `phase_${index}`, label: `Phase ${index}`, source: 'browser',
    properties: Object.fromEntries(['kind', 'part'].map(name => [name, { type: 'integer', required: true, purpose: 'Finite reviewed dimension', minimum: 0, maximum: 15 }])) }));
  value.funnels[0].steps = value.events.map((event: { name: string }) => ({ eventName: event.name, source: 'browser' }));
  value.funnels[0].dimensions = ['kind', 'part'];
  const registry = validateRegistry(value), now = Date.parse('2026-11-03T12:00:00Z');
  const dates = Array.from({ length: 31 }, (_, index) => new Date(Date.parse('2026-10-01') + index * DAY).toISOString().slice(0, 10));
  const meta = { projectId: registry.project.id, schemaVersion: 1, from: dates[0]!, to: dates.at(-1)!,
    timeZone: registry.project.timeZone, generatedAt: new Date(now).toISOString(), latestReceivedAt: null, coverage: 'observed-only' as const };
  const input = { projectId: registry.project.id, version: 1, kind: 'funnel-breakdown' as const, name: 'conversion', groupBy: 'kind' };
  const rows = dates.flatMap(cohort_date => Array.from({ length: 256 }, (_, combo) => {
    const dimension_key = dimensionKey({ kind: combo % 16, part: Math.floor(combo / 16) }, ['kind', 'part']);
    return Array.from({ length: 10 }, (_, step_index) => ({ cohort_date, dimension_key, step_index, reached_count: 10 - step_index }));
  }).flat());
  return { registry, dates, meta, input, now, rows,
    run: (selected = rows, groupBy = 'kind', reg = registry) => funnelBreakdown(reg, { ...input, groupBy }, meta, dates, selected, now) };
}

test('maximum funnel input parses each dimension once without mutating rows and preserves counts for either groupBy', t => {
  const f = fixture(); assert.equal(f.rows.length, FUNNEL_DIMENSION_ROW_LIMIT);
  f.rows.forEach(Object.freeze); Object.freeze(f.rows);
  const parser = t.mock.method(JSON, 'parse');
  const result = f.run(); assert.equal(parser.mock.callCount(), 256);
  assert.equal(result.summary.startedRuns, 31 * 256 * 10); assert.equal(result.summary.completedRuns, 31 * 256);
  assert.deepEqual(result.buckets.map(bucket => bucket.value).sort((a, b) => Number(a) - Number(b)), Array.from({ length: 16 }, (_, i) => i));
  for (const bucket of result.buckets) {
    assert.equal(bucket.summary.startedRuns, 31 * 16 * 10); assert.equal(bucket.days.length, 31);
    assert.equal(bucket.days[0]!.startedRuns, 160); assert.equal(bucket.days[0]!.completedRuns, 16);
  }
  parser.mock.resetCalls();
  const other = f.run(f.rows, 'part'); assert.equal(parser.mock.callCount(), 256);
  assert.equal(other.buckets.find(bucket => bucket.value === 0)!.summary.startedRuns, 31 * 16 * 10);
});

test('cached dimensions cannot bypass per-row counts, step ordering, duplicates or canonical tuple equality', () => {
  const f = fixture(), rows = f.rows.slice(0, 10);
  for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const modified = rows.map(row => ({ ...row })); modified[1]!.reached_count = bad;
    assert.throws(() => f.run(modified), { code: 'storage_unavailable' });
  }
  const reversed = rows.map(row => ({ ...row })); reversed[1]!.reached_count = 11;
  assert.throws(() => f.run(reversed), { code: 'storage_unavailable' });
  assert.throws(() => f.run([...rows, rows[0]!]), { code: 'storage_unavailable' });
  const alias = { ...rows[0]!, dimension_key: JSON.stringify(JSON.parse(rows[0]!.dimension_key).reverse()) };
  assert.throws(() => f.run([...rows, alias]), { code: 'storage_unavailable' });
  const maximum = rows.map(row => ({ ...row, reached_count: Number.MAX_SAFE_INTEGER }));
  assert.throws(() => f.run([...maximum, { ...rows[0]!, reached_count: 1,
    dimension_key: dimensionKey({ kind: 0, part: 1 }, ['kind', 'part']) }]), { code: 'storage_unavailable' });
  const changed = structuredClone(f.registry);
  for (const event of changed.events) event.properties.kind = {
    type: 'integer', required: true, purpose: 'Changed schema', minimum: 1, maximum: 15 };
  assert.throws(() => f.run(rows, 'kind', validateRegistry(changed)), { code: 'storage_unavailable' });
});

test('more than 256 textual aliases remain valid across dates without relaxing the finite combination cap', t => {
  const f = fixture(), rows = f.rows.filter(row => row.cohort_date === f.dates[0] || row.cohort_date === f.dates[1]);
  for (const row of rows) if (row.cohort_date === f.dates[1]) row.dimension_key = JSON.stringify(JSON.parse(row.dimension_key).reverse());
  const parser = t.mock.method(JSON, 'parse');
  const result = f.run(rows);
  assert.equal(result.summary.startedRuns, 2 * 256 * 10);
  assert.ok(parser.mock.callCount() > 256); // Uncached aliases still receive the original validation.
});
