import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canonicalJson, parseSchemaPublication, schemaDefinitions, validateRegistry, validateSchemaDraft } from '../src/index.ts';

const registry = () => JSON.parse(readFileSync(new URL('../../../api/examples/registry.json', import.meta.url), 'utf8'));
const draft = () => { const r = registry(); return { events: r.events, workflows: r.workflows }; };

test('representative workflow is explicit, version-local and preserves absent-field hashes', () => {
  const legacy = draft(), selected = { ...legacy, representativeWorkflowId: legacy.workflows[0].id };
  const freeze = (value: any): any => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(selected);
  assert.equal(validateSchemaDraft(selected).valid, true);
  assert.equal(validateRegistry({ ...registry(), ...selected }).representativeWorkflowId, selected.representativeWorkflowId);
  const published = parseSchemaPublication({ ...selected, expectedLatestVersion: 1, privacyReviewed: true });
  assert.equal(canonicalJson(schemaDefinitions(published)), canonicalJson(selected));
  assert.equal(Object.hasOwn(schemaDefinitions(legacy), 'representativeWorkflowId'), false);
  assert.equal(canonicalJson(schemaDefinitions(legacy)), canonicalJson(legacy));
  for (const id of ['', null, undefined, 1, {}, 'missing', 'x'.repeat(49)]) {
    const invalid = { ...legacy, representativeWorkflowId: id };
    assert.deepEqual(validateSchemaDraft(invalid).issues, [{ path: '/representativeWorkflowId', code: 'invalid_reference' }]);
    assert.throws(() => parseSchemaPublication({ ...invalid, expectedLatestVersion: 1, privacyReviewed: true }));
  }
  assert.equal(validateSchemaDraft({ ...selected, workflows: [] }).valid, false);
  for (const length of [1, 48]) {
    const id = 'w'.repeat(length), workflows = [{ ...legacy.workflows[0], id }];
    assert.equal(validateSchemaDraft({ ...legacy, workflows, representativeWorkflowId: id }).valid, true);
  }
});
test('draft validation shares registration rules and leaves definitions unchanged', () => {
  const input = draft(), before = structuredClone(input);
  assert.deepEqual(validateSchemaDraft(input), { valid: true, issues: [], privacyReviewRequired: true });
  validateRegistry({ ...registry(), ...input });
  assert.deepEqual(input, before);
});
test('draft diagnostics locate the first issue without echoing private values', () => {
  const cases: [((input: any) => void), string, string][] = [
    [d => { d.events.push(d.events[0]); }, `/events/${draft().events.length}/name`, 'duplicate'],
    [d => { d.events[0].label = ''; }, '/events/0', 'invalid_definition'],
    [d => { d.events[0].source = ['browser']; }, '/events/0', 'invalid_definition'],
    [d => { d.events[0].properties.tool.values = ['private free text']; }, '/events/0/properties/tool', 'invalid_definition'],
    [d => { d.events[0].properties.tool = { type: 'integer', minimum: 0, maximum: 32, required: true, purpose: 'bucket' }; }, '/events/0/properties/tool', 'cardinality_limit'],
    [d => { d.events[0].properties = Object.fromEntries(['a', 'b', 'c', 'd'].map(k => [k, { type: 'integer', minimum: 0, maximum: 4, required: true, purpose: 'bucket' }])); }, '/events/0/properties', 'cardinality_limit'],
    [d => { d.workflows[0].successEvent = 'missing'; }, '/workflows/0/successEvent', 'invalid_reference'],
    [d => { d.workflows[0].successEvent = d.workflows[0].startEvent; }, '/workflows/0/successEvent', 'invalid_reference'],
    [d => { d.events.find((e: any) => e.name === d.workflows[0].successEvent).properties.tool.required = false; }, '/workflows/0/dimensions/0', 'dimension_mismatch'],
    [d => { d.events.forEach((e: any) => { e.source = 'server'; }); }, '/workflows/0/startEvent', 'invalid_reference'],
    [d => { d.events = []; }, '/events', 'definition_limit'],
    [d => { d.workflows = Array(11).fill(d.workflows[0]); }, '/workflows', 'definition_limit'],
  ];
  for (const [mutate, path, code] of cases) {
    const input = draft(); mutate(input);
    assert.deepEqual(validateSchemaDraft(input), { valid: false, issues: [{ path, code }], privacyReviewRequired: true });
    assert.throws(() => validateRegistry({ ...registry(), ...input }));
  }
});

test('server-only definitions need no browser events or origins but cannot bind browser workflows', () => {
  const original = registry();
  const input = { ...original, allowedOrigins: [], events: original.events.map((event: any) => ({ ...event, source: 'server' })), workflows: [] };
  assert.deepEqual(validateSchemaDraft({ events: input.events, workflows: [] }), { valid: true, issues: [], privacyReviewRequired: true });
  assert.deepEqual(validateRegistry(input), input);
  assert.equal(validateSchemaDraft({ events: [], workflows: [] }).valid, false);
  assert.deepEqual(validateSchemaDraft({ events: input.events, workflows: original.workflows }).issues,
    [{ path: '/workflows/0/startEvent', code: 'invalid_reference' }]);
});
test('optional missing buckets count toward cardinality and dimensions compare normalized enum domains', () => {
  const input = draft();
  input.events.find((e: any) => e.name === input.workflows[0].successEvent).properties.tool.values.reverse();
  assert.equal(validateSchemaDraft(input).valid, true);
  input.events[0].properties = Object.fromEntries(['a', 'b'].map(k => [k, {
    type: 'integer', minimum: 0, maximum: 15, required: false, purpose: 'optional bucket',
  }]));
  assert.deepEqual(validateSchemaDraft(input).issues, [{ path: '/events/0/properties', code: 'cardinality_limit' }]);
});

test('optional ordered funnels participate in schema validation/publication without changing legacy definitions', () => {
  const input = JSON.parse(readFileSync(new URL('../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
  const definitions = schemaDefinitions(validateRegistry(input));
  assert.deepEqual(definitions.funnels, input.funnels);
  assert.equal(validateSchemaDraft(definitions).valid, true);
  const published = parseSchemaPublication({ ...definitions, expectedLatestVersion: 1, privacyReviewed: true });
  assert.equal(canonicalJson(schemaDefinitions(published)), canonicalJson(definitions));
  assert.equal(canonicalJson(schemaDefinitions(registry())), canonicalJson(draft()));
  assert.equal(Object.hasOwn(validateRegistry(registry()), 'funnels'), false);
  assert.equal(canonicalJson(schemaDefinitions({ ...registry(), funnels: [] })), canonicalJson({ ...draft(), funnels: [] }));
  for (const [mutate, path, code] of [
    [(d: any) => { d.funnels[0].steps[2].source = 'browser'; }, '/funnels/0/steps/2', 'invalid_reference'],
    [(d: any) => { d.funnels[0].steps.push(d.funnels[0].steps[0]); }, '/funnels/0/steps/4/eventName', 'duplicate'],
    [(d: any) => { d.funnels[0].dimensions = ['missing']; }, '/funnels/0/dimensions/0', 'dimension_mismatch'],
    [(d: any) => { d.funnels = null; }, '/funnels', 'definition_limit'],
    [(d: any) => { d.funnels = Array(11).fill(d.funnels[0]); }, '/funnels', 'definition_limit'],
  ] as const) {
    const invalid = structuredClone(definitions); mutate(invalid);
    assert.deepEqual(validateSchemaDraft(invalid).issues, [{ path, code }]);
    assert.throws(() => parseSchemaPublication({ ...invalid, expectedLatestVersion: 1, privacyReviewed: true }));
  }
});
