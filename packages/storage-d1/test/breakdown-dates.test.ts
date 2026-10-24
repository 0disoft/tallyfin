import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DAY, dimensionKey, validateRegistry } from '@tallyfin/core';
import type { QueryMeta, Registry } from '@tallyfin/core';
import { workflowBreakdown } from '../src/workflow-breakdown.ts';
import { funnelBreakdown } from '../src/funnel-breakdown.ts';

function fixture(kind: 'workflow' | 'funnel') {
  const name = kind === 'workflow' ? 'registry' : 'funnel-registry';
  const registry: Registry = JSON.parse(readFileSync(new URL(`../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
  const dimension = kind === 'workflow' ? 'tool' : 'kind';
  registry.project.timeZone = 'America/New_York';
  for (const event of registry.events) event.properties[dimension] = {
    type: 'integer', required: true, purpose: 'Finite test buckets', minimum: 0, maximum: 31,
  };
  const reg = validateRegistry(registry);
  return (dates: string[], now: number, buckets = 32) => {
    const meta: QueryMeta = { projectId: reg.project.id, schemaVersion: 1, source: 'browser',
      from: dates[0]!, to: dates.at(-1)!, timeZone: reg.project.timeZone,
      generatedAt: new Date(now).toISOString(), latestReceivedAt: null, coverage: 'observed-only' };
    const dimensions = Array.from({ length: buckets }, (_, value) => ({
      cohort_date: dates[0]!, dimension_key: dimensionKey({ [dimension]: value }, [dimension]),
    }));
    if (kind === 'workflow') return workflowBreakdown(reg, { projectId: reg.project.id, version: 1,
      kind: 'workflow-breakdown', name: 'calculation', groupBy: dimension }, meta, dates,
      dimensions.map(row => ({ ...row, started_count: 4, succeeded_count: 2, failed_count: 0 })), now);
    const { source: _source, ...funnelMeta } = meta;
    return funnelBreakdown(reg, { projectId: reg.project.id, version: 1,
      kind: 'funnel-breakdown', name: 'conversion', groupBy: dimension }, funnelMeta, dates,
      dimensions.flatMap(row => [4, 3, 2, 1].map((reached_count, step_index) => ({ ...row, reached_count, step_index }))), now);
  };
}

for (const kind of ['workflow', 'funnel'] as const) {
  test(`${kind} breakdown computes local date boundaries once per date at maximum bucket count`, t => {
    const run = fixture(kind), start = Date.parse('2026-03-01T00:00:00Z');
    const dates = Array.from({ length: 31 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
    const NativeFormatter = Intl.DateTimeFormat;
    const formatter = t.mock.method(Intl, 'DateTimeFormat', function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new NativeFormatter(...args);
    });
    const formats = t.mock.method(Intl.DateTimeFormat.prototype, 'formatToParts');
    const now = Date.parse('2026-03-11T04:00:00Z');
    run(dates, now, 1);
    const singleBucketCalls = formats.mock.callCount();
    assert.ok(singleBucketCalls > 0);
    formats.mock.resetCalls();
    const result = run(dates, now);
    assert.equal(formats.mock.callCount(), singleBucketCalls);
    assert.ok(formatter.mock.callCount() <= 1);
    assert.equal(result.buckets.length, 32);
    for (const bucket of result.buckets) {
      assert.deepEqual(bucket.days.map(day => day.date), dates);
      assert.deepEqual(bucket.days.map(day => day.provisional), dates.map(date => date >= '2026-03-09'));
      if ('startedAttempts' in bucket.summary) {
        assert.equal(bucket.summary.startedAttempts, 4);
        assert.equal(bucket.days[1]!.startedAttempts, 0);
      } else {
        assert.equal(bucket.summary.startedRuns, 4);
        assert.equal(bucket.days[1]!.startedRuns, 0);
      }
      assert.equal(bucket.days[1]!.completionRate, null);
    }
  });

  test(`${kind} breakdown keeps DST boundaries and request-local freshness`, () => {
    const run = fixture(kind);
    for (const [date, deadline] of [
      ['2026-03-08', '2026-03-11T04:00:00Z'],
      ['2026-11-01', '2026-11-04T05:00:00Z'],
    ]) {
      const at = Date.parse(deadline!);
      for (const offset of [-1, 0, 1]) {
        const result = run([date!], at + offset, 2);
        for (const bucket of result.buckets) assert.equal(bucket.days[0]!.provisional, offset < 0);
      }
    }
  });

  test(`${kind} empty breakdown skips local date boundary calculations`, t => {
    const run = fixture(kind), NativeFormatter = Intl.DateTimeFormat;
    const formatter = t.mock.method(Intl, 'DateTimeFormat', function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new NativeFormatter(...args);
    });
    const formats = t.mock.method(Intl.DateTimeFormat.prototype, 'formatToParts');
    assert.deepEqual(run(['2026-03-08'], Date.parse('2026-03-11T04:00:00Z'), 0).buckets, []);
    assert.equal(formatter.mock.callCount(), 0);
    assert.equal(formats.mock.callCount(), 0);
  });
}
