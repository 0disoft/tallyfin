import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSchemaDefinitions, loadSchemaComparison } from './schema-comparison.ts';
import { ApiError } from './api-error.ts';

const event = (name = 'start') => ({ name, label: name, source: 'browser', properties: {
  tool: { type: 'enum', required: true, purpose: '공개 도구', values: ['one', 'two'] },
} });
const definitions = () => ({ events: [event(), event('success')], workflows: [{ id: 'task', label: '작업', source: 'browser',
  startEvent: 'start', successEvent: 'success', failureEvent: null, dimensions: ['tool'] }],
  funnels: [{ id: 'funnel', label: '퍼널', dimensions: ['tool'], steps: [
    { eventName: 'start', source: 'browser' }, { eventName: 'success', source: 'browser' },
  ] }], representativeWorkflowId: 'task' });
const registry = (version, projectId = 'sample') => ({ ...definitions(), project: { id: projectId }, schemaVersion: version });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('equal definitions ignore object key order, registry settings, and omitted empty funnels', () => {
  const a = definitions(), b = structuredClone(a);
  b.events[0].properties.tool = { purpose: '공개 도구', values: ['one', 'two'], required: true, type: 'enum' };
  assert.deepEqual(compareSchemaDefinitions(a, b), []);
  delete a.funnels; b.funnels = [];
  assert.deepEqual(compareSchemaDefinitions(a, b), []);
  assert.deepEqual(compareSchemaDefinitions(registry(1), { ...registry(2), limits: { requestsPerMinute: 999 } }), []);
});

test('events match by name and report source changes, removal, addition in old-then-new order', () => {
  const a = definitions(), b = structuredClone(a);
  b.events[0].source = 'server'; b.events.splice(1, 1, event('replacement'));
  const rows = compareSchemaDefinitions(freeze(a), freeze(b));
  assert.deepEqual(rows.map(r => [r.name, r.field, r.kind]), [
    ['start', 'source', 'changed'], ['success', 'definition', 'removed'], ['replacement', 'definition', 'added'],
  ]);
  rows[1].before.properties.tool.values.push('detached');
  assert.deepEqual(a.events[1].properties.tool.values, ['one', 'two']);
});

test('property type, required flag, purpose, allowed values, and numeric bounds keep exact before/after values', () => {
  const a = definitions(), b = structuredClone(a);
  b.events[0].properties.tool = { type: 'integer', required: false, purpose: '종류 번호', minimum: 0, maximum: 1 };
  const rows = compareSchemaDefinitions(a, b);
  assert.deepEqual(rows.map(r => r.field), ['type', 'required', 'purpose', 'values', 'minimum', 'maximum']);
  assert.deepEqual(rows.find(r => r.field === 'required'), {
    section: 'property', name: 'start.tool', field: 'required', kind: 'changed', before: true, after: false,
  });
  assert.equal(rows.find(r => r.field === 'minimum').after, 0);
  assert.equal(rows.find(r => r.field === 'values').kind, 'removed');
  assert.ok(rows.every(r => r.section === 'property'));
  const c = structuredClone(a); c.events[0].properties.tool.values.reverse();
  assert.equal(compareSchemaDefinitions(a, c)[0].field, 'values');
});

test('property additions/removals, labels, and optional representative workflow changes are visible', () => {
  const a = definitions(), b = structuredClone(a);
  delete b.events[0].properties.tool; b.events[0].properties.enabled = { type: 'boolean', required: false, purpose: '기능' };
  b.events[0].label = '변경'; delete b.representativeWorkflowId;
  assert.deepEqual(compareSchemaDefinitions(a, b).map(r => [r.name, r.field, r.kind]), [
    ['start', 'label', 'changed'], ['start.tool', 'definition', 'removed'], ['start.enabled', 'definition', 'added'],
    ['representativeWorkflowId', 'representativeWorkflowId', 'removed'],
  ]);
});

test('workflow references, optional failure classification, dimensions and ordered funnel steps are compared', () => {
  const a = definitions(), b = structuredClone(a);
  b.workflows[0].startEvent = 'other'; b.workflows[0].successEvent = 'done'; b.workflows[0].failureEvent = 'failed';
  b.workflows[0].failureReasonProperty = 'reason'; b.workflows[0].dimensions = [];
  b.funnels[0].steps.reverse(); b.funnels[0].steps[0].source = 'server'; b.funnels[0].dimensions = [];
  assert.deepEqual(compareSchemaDefinitions(a, b).map(r => [r.section, r.field]), [
    ['workflow', 'startEvent'], ['workflow', 'successEvent'], ['workflow', 'failureEvent'],
    ['workflow', 'failureReasonProperty'], ['workflow', 'dimensions'], ['funnel', 'dimensions'], ['funnel', 'steps'],
  ]);
  const c = structuredClone(a); c.workflows = []; c.funnels = [];
  assert.deepEqual(compareSchemaDefinitions(a, c).slice(0, 2).map(r => [r.section, r.kind]), [['workflow', 'removed'], ['funnel', 'removed']]);
  assert.deepEqual(compareSchemaDefinitions(c, a).slice(0, 2).map(r => [r.section, r.kind]), [['workflow', 'added'], ['funnel', 'added']]);
});

test('entity display reordering is distinguished from definition changes and does not mutate arguments', () => {
  const a = definitions(), b = structuredClone(a); b.events.reverse();
  const original = JSON.stringify([a, b]);
  assert.deepEqual(compareSchemaDefinitions(freeze(a), freeze(b)), [{ section: 'schema', name: 'event', field: 'order',
    kind: 'changed', before: ['start', 'success'], after: ['success', 'start'] }]);
  assert.equal(JSON.stringify([a, b]), original);
});

test('property names that shadow Object.prototype remain additions and removals', () => {
  const a = definitions(), b = structuredClone(a);
  b.events[0].properties.constructor = { type: 'boolean', required: false, purpose: '선택' };
  assert.equal(compareSchemaDefinitions(a, b)[0].kind, 'added');
  assert.equal(compareSchemaDefinitions(b, a)[0].kind, 'removed');
});

test('comparison performs exactly two reads, including retired versions, with one shared cancellation scope', async () => {
  const calls = [], controller = new AbortController();
  const result = await loadSchemaComparison({ getSchema: async (id, version, options) => {
    calls.push({ id, version, ...options }); return { ...registry(version), schemaStatus: 'retired' };
  } }, 'sample', 2147483647, 1, controller.signal);
  assert.deepEqual(result, { from: 2147483647, to: 1, changes: [] });
  assert.deepEqual(calls.map(c => [c.id, c.version]), [['sample', 2147483647], ['sample', 1]]);
  assert.equal(calls[0].signal, calls[1].signal); assert.equal(calls[0].signal.aborted, true);
});

test('invalid, same, and pre-cancelled versions never start I/O', async () => {
  let calls = 0; const client = { getSchema: async () => { calls++; } };
  for (const [a, b] of [[1, 1], [0, 1], [1, 2147483648], [NaN, 2], [1.1, 2]])
    await assert.rejects(loadSchemaComparison(client, 'sample', a, b, new AbortController().signal), e => e.kind === 'invalid_request');
  const controller = new AbortController(), reason = Error('cancelled'); controller.abort(reason);
  await assert.rejects(loadSchemaComparison(client, 'sample', 1, 2, controller.signal), e => e === reason);
  assert.equal(calls, 0);
});

test('failed or denied reads cancel siblings and preserve the original error without retry', async () => {
  for (const kind of ['forbidden', 'unauthorized', 'not_found', 'network']) {
    const error = new ApiError(kind, kind), signals = [];
    await assert.rejects(loadSchemaComparison({ getSchema: async (_id, version, options) => {
      signals.push(options.signal);
      if (version === 1) throw error;
      return new Promise(resolve => options.signal.addEventListener('abort', () => resolve(registry(2)), { once: true }));
    } }, 'sample', 1, 2, new AbortController().signal), e => e === error);
    assert.equal(signals.length, 2); assert.ok(signals.every(s => s.aborted));
  }
});

test('cancellation discards late responses even if a transport ignores abort', async () => {
  const controller = new AbortController(), held = deferred(), reason = Error('scope changed');
  const result = loadSchemaComparison({ getSchema: async (_id, version) => { await held.promise; return registry(version); } }, 'sample', 1, 2, controller.signal);
  controller.abort(reason); held.resolve();
  await assert.rejects(result, e => e === reason);
});

test('cross-project or mismatched version responses cannot produce a comparison', async () => {
  for (const wrong of [registry(3), registry(2, 'other')])
    await assert.rejects(loadSchemaComparison({ getSchema: async (_id, version) => version === 1 ? registry(1) : wrong },
      'sample', 1, 2, new AbortController().signal), e => e.kind === 'contract');
});
