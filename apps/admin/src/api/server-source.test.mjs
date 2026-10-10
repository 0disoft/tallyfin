import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ApiClient } from './client.ts';
import { analyticsCsv, CSV_COLUMNS } from './csv-export.ts';
import { analyzeEventSeries, eventContext, eventPropertyNames, selectedGrouping } from './event-analysis.ts';
import { compareEventProperties, loadEventPropertyComparison } from './event-property-comparison.ts';
import { comparisonRows, loadPeriod, previousRange, validateSnapshot } from './period-comparison.ts';
import { parseWorkflowBreakdownResponse, parseWorkflowResponse } from './validate.ts';

function fixture() {
  const project = { id: 'jobs', name: 'Jobs', status: 'active', timeZone: 'UTC' };
  const event = { name: 'job_finished', label: 'Finished', source: 'server', properties: {
    retried: { type: 'boolean', required: false, purpose: 'Retry category' },
  } };
  const workflow = { id: 'job', label: 'Job', source: 'browser', startEvent: 'start', successEvent: 'success', failureEvent: null, dimensions: [] };
  const registry = { project, schemaVersion: 1, schemaStatus: 'active', events: [event,
    { name: 'start', label: 'Start', source: 'browser', properties: {} }, { name: 'success', label: 'Success', source: 'browser', properties: {} }], workflows: [workflow] };
  const range = { from: '2026-10-10', to: '2026-10-11' };
  const meta = { projectId: 'jobs', schemaVersion: 1, source: 'server', ...range, timeZone: 'UTC',
    generatedAt: '2026-10-11T06:00:00Z', latestReceivedAt: null, coverage: 'observed-only' };
  const series = { meta, eventName: event.name, groupBy: 'retried', totalEvents: 3, days: [
    { date: range.from, count: 1, breakdown: [{ value: false, count: 1 }] },
    { date: range.to, count: 2, breakdown: [{ value: null, count: 1 }, { value: true, count: 1 }] },
  ] };
  const snapshot = { range, summary: { meta, totalEvents: 3, events: [{ name: event.name, count: 3 }] }, workflows: [] };
  const priorRange = previousRange(range);
  const previous = { ...structuredClone(series), meta: { ...meta, ...priorRange },
    days: series.days.map((day, index) => ({ ...structuredClone(day), date: index ? priorRange.to : priorRange.from })) };
  return { registry, event, range, meta, series, snapshot, previous };
}
const options = f => ({ schemaVersion: 1, ...f.range, source: 'server' });
const rows = file => file.text.slice(1).trimEnd().split('\r\n').slice(1).map(line => {
  const cells = [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"'));
  return Object.fromEntries(CSV_COLUMNS.map((column, i) => [column, cells[i]]));
});

test('server reads send the explicit source and reject opposite-source responses or invalid source before fetch', async () => {
  const f = fixture(), calls = [];
  let reply = f.snapshot.summary;
  const client = new ApiClient({ fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json(reply); } });
  assert.deepEqual(await client.getSummary('jobs', options(f)), reply);
  assert.equal(new URL(calls[0].url, 'https://example.invalid').searchParams.get('source'), 'server');
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.cache, 'no-store');
  reply = f.series;
  assert.deepEqual(await client.getEventDaily('jobs', f.event.name, { ...options(f), groupBy: 'retried' }), reply);
  for (const source of ['browser', 'all']) {
    reply = { ...f.snapshot.summary, meta: { ...f.meta, source } };
    await assert.rejects(client.getSummary('jobs', options(f)), error => error.kind === 'contract');
  }
  reply = f.snapshot.summary;
  await assert.rejects(client.getSummary('jobs', { schemaVersion: 1, ...f.range }), error => error.kind === 'contract');
  const before = calls.length;
  for (const source of ['', null, 'all']) await assert.rejects(client.getSummary('jobs', { ...options(f), source }));
  assert.equal(calls.length, before);
});

test('workflow response parsers remain browser-only even when event response parsers support server source', () => {
  const wire = JSON.parse(readFileSync(new URL('../../../../api/examples/workflow-response.json', import.meta.url), 'utf8'));
  assert.equal(parseWorkflowResponse(wire).meta.source, 'browser');
  wire.meta.source = 'server';
  assert.throws(() => parseWorkflowResponse(wire));
  assert.throws(() => parseWorkflowBreakdownResponse({ ...wire, groupBy: 'tool', buckets: [] }));
});

test('server period snapshots never load or accept browser workflow completion, and empty server definitions remain explicit', async () => {
  const f = fixture(), calls = [];
  const client = new ApiClient({ fetchImpl: async url => { calls.push(url); return Response.json(f.snapshot.summary); } });
  const result = await loadPeriod(client, f.registry, f.range, new AbortController().signal, 'server');
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('/summary')); assert.deepEqual(result.workflows, []);
  validateSnapshot(result, f.registry, 'server');
  assert.throws(() => validateSnapshot(result, f.registry));
  assert.throws(() => validateSnapshot({ ...result, workflows: [{ definition: f.registry.workflows[0] }] }, f.registry, 'server'));
  const empty = { ...result, summary: { ...result.summary, totalEvents: 0, events: [] } };
  validateSnapshot(empty, { ...f.registry, events: f.registry.events.filter(event => event.source === 'browser') }, 'server');
  assert.throws(() => validateSnapshot(empty, f.registry, 'server'));
});

test('server property analysis and prior-period comparisons retain typed buckets and reject cross-source or stale contexts', async () => {
  const f = fixture();
  assert.deepEqual(eventPropertyNames(f.event), ['retried']);
  const selection = { context: eventContext(f.registry, f.event), property: 'retried' };
  assert.equal(selectedGrouping(f.registry, f.event, selection), 'retried');
  assert.equal(selectedGrouping(f.registry, { ...f.event, source: 'browser' }, selection), '');
  assert.equal(analyzeEventSeries(f.series, f.event).rows.find(row => row.value === false).count, 1);
  const compared = compareEventProperties(f.series, f.previous, f.registry);
  assert.equal(compared.rows.length, 3); assert.ok(compared.rows.every(row => row.countChange === 0));
  let requested;
  const client = new ApiClient({ fetchImpl: async url => { requested = url; return Response.json(f.previous); } });
  await loadEventPropertyComparison(client, f.registry, f.series, new AbortController().signal);
  assert.equal(new URL(requested, 'https://example.invalid').searchParams.get('source'), 'server');
  assert.throws(() => compareEventProperties(f.series, { ...f.previous, meta: { ...f.previous.meta, source: 'browser' } }, f.registry));
  assert.throws(() => analyzeEventSeries({ ...f.series, meta: { ...f.meta, source: 'browser' } }, f.event));
});

test('server CSV records only the selected source numbers, marks other sources unselected and excludes browser completion metrics', () => {
  const f = fixture(), previous = { summary: { ...f.snapshot.summary, meta: f.previous.meta }, workflows: [], range: previousRange(f.range) };
  const input = { registry: f.registry, current: f.snapshot, previous, source: 'server', view: 'events',
    selection: { eventName: f.event.name, groupBy: 'retried', series: f.series, previousSeries: f.previous } };
  const file = analyticsCsv(input);
  assert.ok(file.filename.includes('-events-server-'));
  const output = rows(file);
  const event = output.find(row => row.record_type === 'event_total' && row.name === 'job_finished');
  assert.equal(event.source, 'server'); assert.equal(event.count, '3'); assert.equal(event.availability, 'available');
  const browser = output.find(row => row.record_type === 'event_total' && row.source === 'browser');
  assert.equal(browser.count, ''); assert.equal(browser.availability, 'not_selected');
  assert.ok(output.some(row => row.record_type === 'property_day' && row.value === 'false'));
  assert.ok(!output.some(row => row.record_type.startsWith('workflow_')));
  assert.throws(() => analyticsCsv({ ...input, source: 'browser' }));
  assert.throws(() => analyticsCsv({ ...input, view: 'goals' }));
  assert.throws(() => analyticsCsv({ ...input, previous: { ...previous, summary: { ...previous.summary, meta: { ...previous.summary.meta, source: 'browser' } } } }));
  assert.throws(() => comparisonRows(f.snapshot, { ...previous, summary: { ...previous.summary, meta: { ...previous.summary.meta, source: 'browser' } } }, 'events'));
});
