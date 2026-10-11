import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApiClient } from './client.ts';
import { parseFunnelBreakdown, validateFunnelBreakdown, FunnelBreakdownReport } from './funnel-breakdown.ts';
import { funnelCsv } from './funnel-csv.ts';
import { parseFunnelResponse } from './funnel-contract.ts';

const fixture = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
const body = () => fixture('funnel-breakdown-response');
const registry = () => fixture('funnel-registry');
const range = { from: '2026-10-08', to: '2026-10-09' };
const ok = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('breakdown parser validates closed shapes, typed values, day/stage rates and bucket-to-summary reconciliation', () => {
  const data = parseFunnelBreakdown(body());
  validateFunnelBreakdown(data, registry(), range, 'conversion', 'kind');
  assert.deepEqual(data.buckets.map(bucket => bucket.value), ['image', 'pdf']);
  for (const mutate of [v => v.runId = 'private-marker', v => v.meta.source = 'browser', v => delete v.summary,
    v => v.buckets[0].extra = 'private-marker', v => v.buckets[0].value = null, v => v.buckets[0].value = 'free text',
    v => v.buckets[0].value = v.buckets[1].value, v => v.buckets = Array(33).fill(v.buckets[0]),
    v => v.buckets[0].days.reverse(), v => v.buckets[0].days[0].steps[1].reachedRuns++,
    v => v.buckets[0].summary.steps[1].reachRate = 12, v => v.buckets[0].days[0].provisional = true,
    v => v.summary.startedRuns++, v => v.groupBy = 'unknown']) {
    const value = body(); mutate(value); assert.throws(() => parseFunnelBreakdown(value));
  }
});
test('false and zero stay typed and registry validation rejects an unregistered value despite a valid wire shape', () => {
  for (const [value, rule] of [[false, { type: 'boolean', required: true, purpose: 'Finite classification' }],
    [0, { type: 'integer', required: true, purpose: 'Finite classification', minimum: 0, maximum: 1 }]]) {
    const response = body(); response.buckets.forEach((bucket, index) => { bucket.value = typeof value === 'boolean' ? !!index : index; });
    const reg = registry(); reg.events.forEach(event => { event.properties.kind = rule; });
    const data = parseFunnelBreakdown(response); validateFunnelBreakdown(data, reg, range, 'conversion', 'kind');
    assert.equal(data.buckets[0].value, value);
    assert.throws(() => validateFunnelBreakdown(data, registry(), range, 'conversion', 'kind'));
  }
  const response = body(); response.buckets[0].value = 'unregistered';
  assert.throws(() => validateFunnelBreakdown(parseFunnelBreakdown(response), registry(), range, 'conversion', 'kind'));
});
test('empty observations require a zero summary with null rates, not an invented bucket', () => {
  const response = body(); response.buckets = [];
  assert.throws(() => parseFunnelBreakdown(response));
  response.summary = { startedRuns: 0, completedRuns: 0, completionRate: null,
    steps: response.summary.steps.map((step, index, steps) => ({ stepIndex: index, reachedRuns: 0, reachRate: null, conversionRate: null, notReachedNext: index < steps.length - 1 ? 0 : null })) };
  assert.deepEqual(parseFunnelBreakdown(response).buckets, []);
});
test('client uses authenticated same-origin bounded grouping and refuses mismatched requested metadata', async () => {
  const calls = [], client = new ApiClient({ token: 'test-only-token', fetchImpl: async (url, options) => { calls.push({ url, options }); return ok(body()); } });
  const data = await client.getFunnelBreakdown('modufile', 'conversion', { schemaVersion: 1, ...range, groupBy: 'kind' });
  assert.equal(data.groupBy, 'kind'); assert.equal(calls[0].url, '/v1/projects/modufile/funnels/conversion/breakdown?schemaVersion=1&from=2026-10-08&to=2026-10-09&groupBy=kind');
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-token');
  for (const options of [{ groupBy: 'bad value' }, { schemaVersion: 0 }])
    await assert.rejects(client.getFunnelBreakdown('modufile', 'conversion', { schemaVersion: 1, ...range, groupBy: 'kind', ...options }), { kind: 'invalid_request' });
  assert.equal(calls.length, 1);
  for (const mutate of [v => v.meta.projectId = 'other', v => v.meta.schemaVersion++, v => v.funnelId = v.definition.id = 'other']) {
    const response = body(); mutate(response);
    const mismatch = new ApiClient({ token: 'test-only-token', fetchImpl: async () => ok(response) });
    await assert.rejects(mismatch.getFunnelBreakdown('modufile', 'conversion', { schemaVersion: 1, ...range, groupBy: 'kind' }), { kind: 'contract' });
  }
});
test('report cancels stale reads and rejects invalid registered values while preserving fixed failure states', async () => {
  const pending = deferred(), signals = [], events = []; let count = 0;
  const client = new ApiClient({ token: 'test-only-token', fetchImpl: async (_url, options) => { signals.push(options.signal); return ++count === 1 ? pending.promise : ok(body()); } });
  const report = new FunnelBreakdownReport(client, state => events.push(state));
  const old = report.load(registry(), range, 'conversion', 'kind', 'old');
  await report.load(registry(), range, 'conversion', 'kind', 'new');
  pending.resolve(ok(body())); await old;
  assert.equal(signals[0].aborted, true); assert.equal(events.at(-1).context, 'new'); assert.equal(events.at(-1).phase, 'ready');
  report.dispose(); await report.load(registry(), range, 'conversion', 'kind', 'disposed'); assert.equal(count, 2);
  const states = [], bad = body(); bad.buckets[0].value = 'unregistered';
  const invalid = new FunnelBreakdownReport(new ApiClient({ token: 'test-only-token', fetchImpl: async () => ok(bad) }), state => states.push(state));
  await invalid.load(registry(), range, 'conversion', 'kind', 'invalid'); assert.equal(states.at(-1).phase, 'error');
  assert.equal(states.at(-1).data, undefined);
});
test('grouped CSV preserves projection metadata, data types and current rows independently of whole-period counts', () => {
  const response = parseFunnelResponse(fixture('funnel-response')), grouped = parseFunnelBreakdown(body());
  const csv = funnelCsv(response, undefined, grouped), lines = csv.slice(1).trimEnd().split('\r\n');
  const cells = line => line.split(',').map(value => value.replace(/^"|"$/g, '').replaceAll('""', '"'));
  const columns = cells(lines[0]), rows = lines.slice(1).map(cells), value = (row, key) => row[columns.indexOf(key)];
  assert.ok(rows.every(row => row.length === columns.length));
  assert.equal(rows.filter(row => value(row, 'row_type') === 'property_summary').length, 8);
  const pdf = rows.find(row => value(row, 'row_type') === 'property_summary' && value(row, 'property_value') === 'pdf');
  assert.equal(value(pdf, 'group_by'), 'kind'); assert.equal(value(pdf, 'property_type'), 'string'); assert.equal(value(pdf, 'period'), 'current');
  assert.equal(value(pdf, 'generated_at'), grouped.meta.generatedAt);
  const wrong = body(); wrong.meta.projectId = 'other'; assert.throws(() => funnelCsv(response, undefined, wrong));
  for (const primitive of [false, 0]) {
    const typed = body(); typed.buckets[0].value = primitive;
    const text = funnelCsv(response, undefined, typed);
    assert.ok(text.includes(typeof primitive)); assert.ok(text.includes(String(primitive)));
  }
});
