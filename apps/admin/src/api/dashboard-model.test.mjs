import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dashboardEvents, workflowRecords } from './dashboard-model.ts';
import { dashboardExport } from './dashboard-export.ts';
import { analyticsCsv } from './csv-export.ts';

const example = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function state() {
  const registry = example('registry'), summary = example('summary-response');
  return { data: { registry, summary, range: { from: summary.meta.from, to: summary.meta.to }, workflows: [], view: 'events' },
    validVersion: true, view: 'events', source: 'browser', query: '', compare: false, comparison: null, comparisonError: null,
    selectedEvent: null, analysisEvent: null, seriesData: null, groupBy: '', propertyComparison: null, workflowDetails: [] };
}

test('event projection preserves definition/unknown order, zero versus unknown, search, duplicates and frozen inputs', () => {
  const registry = example('registry'); registry.events[0].source = 'server';
  const summary = { events: [{ name: 'unknown_b', count: 7 }, { name: 'input_start', count: 9 },
    { name: 'unknown_a', count: 3 }, { name: 'input_start', count: 0 }, { name: 'unknown_b', count: 2 }] };
  freeze(registry); freeze(summary);
  const result = dashboardEvents(registry, summary, 'browser', ' INPUT_ ');
  assert.deepEqual(result.rows.map(row => row.definition.name), [...registry.events.map(event => event.name), 'unknown_b', 'unknown_a', 'unknown_b']);
  assert.equal(result.rows[0].count, null); assert.equal(result.rows[1].count, 0); assert.equal(result.rows[2].count, null);
  assert.deepEqual(result.filtered.map(row => row.definition.name), ['input_start']);
  assert.deepEqual(result.rows.slice(-3).map(row => [row.source, row.count]), [[null, 7], [null, 3], [null, 2]]);
  assert.equal(result.browserCount, registry.events.length - 1); assert.equal(result.serverCount, 1);
  assert.equal(dashboardEvents(registry, summary, 'server', '').rows[1].count, null);
  assert.deepEqual(dashboardEvents(null, summary, 'browser', '').rows, []);
  assert.deepEqual(dashboardEvents(null, null, 'browser', '').filtered, []);
  const records = workflowRecords(freeze({ definition: registry.workflows[0], response: example('workflow-response') }));
  assert.equal(records[0].events.input_start, 1); assert.equal(records[0].events.calculation_success, 1);
});

test('CSV gate priority stays current, previous, selected event, then dimension reads', () => {
  const base = state(), failure = [{ error: new Error('synthetic failure') }], previous = { ...base.data, workflowErrors: failure };
  const detail = { context: 'scope', groupBy: 'tool', status: 'loading', comparisonStatus: 'loading' };
  const blocked = { ...base, data: { ...base.data, workflowErrors: failure }, validVersion: false, compare: true,
    comparison: { status: 'error', data: previous }, comparisonError: 'retention', selectedEvent: 'input_start', groupBy: 'tool', workflowDetails: [detail] };
  const reason = patches => dashboardExport({ ...blocked, ...patches }).unavailable;
  assert.match(reason({}), /^현재 기간/);
  assert.match(reason({ validVersion: true }), /^실패한 작업 흐름/);
  assert.match(reason({ validVersion: true, data: base.data }), /^직전 기간의 실패한/);
  assert.match(reason({ validVersion: true, data: base.data, comparison: null }), /^직전 기간이 보존/);
  assert.match(reason({ validVersion: true, data: base.data, comparison: null, comparisonError: null }), /^직전 기간 비교/);
  const compared = { ...base, compare: true, comparison: { status: 'ready', data: base.data } };
  assert.match(dashboardExport({ ...compared, selectedEvent: 'input_start', workflowDetails: [detail] }).unavailable, /^선택한 이벤트/);
  assert.match(dashboardExport({ ...compared, groupBy: 'tool', workflowDetails: [detail] }).unavailable, /^이벤트 속성별/);
  assert.match(dashboardExport({ ...compared, workflowDetails: [detail] }).unavailable, /^속성별 완료율/);
  assert.match(dashboardExport({ ...compared, workflowDetails: [{ ...detail, status: 'ready' }] }).unavailable, /^속성별 기간 비교/);
  assert.equal(dashboardExport({ ...base, comparisonError: 'retention', comparison: { status: 'error', data: previous } }).unavailable, null);
  assert.equal(dashboardExport({ ...base, view: 'goals', selectedEvent: 'unavailable' }).unavailable, null);
});

test('export preparation borrows frozen reads, includes only ready selections, and never exports settings', () => {
  const base = freeze(state()), ready = dashboardExport(base);
  assert.equal(ready.unavailable, null); assert.equal(ready.input.current, base.data);
  assert.equal(analyticsCsv(ready.input).filename.includes('events'), true);
  const series = example('event-series-response'), breakdown = example('workflow-breakdown-response');
  const complete = freeze({ ...base, query: ' retained ', compare: true, selectedEvent: series.eventName,
    analysisEvent: base.data.registry.events.find(event => event.name === series.eventName), seriesData: series, groupBy: 'tool',
    comparison: { status: 'ready', data: base.data }, propertyComparison: { status: 'ready', series },
    workflowDetails: [{ context: 'scope', groupBy: 'tool', status: 'ready', data: breakdown, comparisonStatus: 'ready', comparisonData: breakdown }] });
  const prepared = dashboardExport(complete);
  assert.equal(prepared.unavailable, null); assert.equal(prepared.input.previous, base.data);
  assert.equal(prepared.input.selection.previousSeries, series); assert.equal(prepared.input.filter, ' retained ');
  assert.deepEqual(prepared.input.workflowSelections, [breakdown]); assert.deepEqual(prepared.input.workflowComparisons, [breakdown]);
  assert.deepEqual(dashboardExport({ ...complete, compare: false }).input.workflowComparisons, []);
  assert.equal(Object.hasOwn(dashboardExport({ ...complete, compare: false }).input, 'previous'), false);
  assert.equal(dashboardExport({ ...base, view: 'settings' }).input, null);
});
