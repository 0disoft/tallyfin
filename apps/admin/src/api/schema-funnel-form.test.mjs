import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateSchemaDraft } from '../../../../packages/core/src/schema.ts';
import { schemaDefinitions } from './schema-contract.ts';
import { changeFunnelForm, readFunnelForm, funnelDimensionChoices, funnelEventChoices, funnelWarnings, funnelFocusAfterChange, funnelIssueTarget } from './schema-funnel-form.ts';

const draft = () => schemaDefinitions(JSON.parse(readFileSync(new URL('../../../../api/examples/funnel-registry.json', import.meta.url), 'utf8')));
const text = () => JSON.stringify(draft());
const action = (kind, extra = {}) => ({ kind, index: 0, ...extra });

test('funnel edits preserve optional absence, unrelated definitions and unknown JSON fields', () => {
  const old = draft(); delete old.funnels;
  assert.equal(Object.hasOwn(readFunnelForm(JSON.stringify(old)), 'funnels'), false);
  const added = JSON.parse(changeFunnelForm(JSON.stringify(old), { kind: 'add' }));
  assert.deepEqual(added.funnels[0], { id: 'funnel_1', label: '', steps: [{ eventName: '', source: 'browser' }, { eventName: '', source: 'browser' }], dimensions: [] });
  assert.deepEqual(added.events, old.events); assert.deepEqual(added.workflows, old.workflows);
  const source = draft(); source.funnels[0].extension = { keep: true }; source.funnels[0].steps[0].extension = 'keep';
  const changed = JSON.parse(changeFunnelForm(JSON.stringify(source), action('edit', { field: 'label', value: '변환 과정' })));
  assert.deepEqual(changed.funnels[0].extension, { keep: true }); assert.equal(changed.funnels[0].steps[0].extension, 'keep');
  assert.equal(validateSchemaDraft(changed).valid, false); // UI cannot silently sanitize an unsupported field.
  assert.deepEqual(changed.events, source.events); assert.deepEqual(changed.workflows, source.workflows);
});
test('step insertion, removal and movement retain complete step objects and enforce boundaries', () => {
  const original = draft(); original.funnels[0].steps[1].extension = 'do not lose';
  const moved = JSON.parse(changeFunnelForm(JSON.stringify(original), action('move-step', { step: 1, direction: 1 })));
  assert.deepEqual(moved.funnels[0].steps[2], original.funnels[0].steps[1]);
  assert.deepEqual(moved.funnels[0].steps[1], original.funnels[0].steps[2]);
  let next = changeFunnelForm(text(), action('add-step'));
  assert.equal(readFunnelForm(next).funnels[0].steps.length, 5);
  next = changeFunnelForm(next, action('remove-step', { step: 4 }));
  assert.deepEqual(JSON.parse(next), draft());
  next = changeFunnelForm(next, action('remove-step', { step: 3 }));
  next = changeFunnelForm(next, action('remove-step', { step: 2 }));
  assert.throws(() => changeFunnelForm(next, action('remove-step', { step: 0 })));
  assert.throws(() => changeFunnelForm(text(), action('move-step', { step: 0, direction: -1 })));
  assert.throws(() => changeFunnelForm(text(), action('move-step', { step: 3, direction: 1 })));
  assert.throws(() => changeFunnelForm(text(), action('move-step', { step: 1, direction: 2 })));
  assert.throws(() => changeFunnelForm(text(), action('event', { step: -1, eventName: 'file_selected', source: 'browser' })));
});
test('event selection binds source atomically; duplicate steps warn and core rejects them', () => {
  const changed = changeFunnelForm(text(), action('event', { step: 0, eventName: 'job_finished', source: 'server' }));
  assert.deepEqual(JSON.parse(changed).funnels[0].steps[0], { eventName: 'job_finished', source: 'server' });
  assert.ok(funnelWarnings(readFunnelForm(changed), 0).some(w => w.step === 0 && /한 단계/.test(w.message)));
  const report = validateSchemaDraft(JSON.parse(changed));
  assert.equal(report.issues[0].code, 'duplicate');
  assert.equal(funnelIssueTarget(changed, report.issues[0]), 'schema-funnel-0-step-3-event');
  assert.throws(() => changeFunnelForm(text(), action('event', { step: 0, eventName: 'job_finished', source: 'browser' })));
  assert.throws(() => changeFunnelForm(text(), action('event', { step: 0, eventName: 'unregistered', source: 'server' })));
  const reused = draft(); reused.funnels.push({ ...structuredClone(reused.funnels[0]), id: 'another' });
  assert.equal(validateSchemaDraft(reused).valid, true); assert.deepEqual(funnelWarnings(readFunnelForm(JSON.stringify(reused)), 0), []);
  assert.equal(funnelEventChoices(readFunnelForm(text())).filter(e => e.source === 'server').length, 2);
});
test('dimension choices retain missing keys and compare required cross-source domains', () => {
  assert.deepEqual(funnelDimensionChoices(readFunnelForm(text()), 0), ['kind']);
  const value = draft(); value.events[2].properties.kind.values.reverse();
  assert.deepEqual(funnelWarnings(readFunnelForm(JSON.stringify(value)), 0), []);
  value.events[2].properties.kind.required = false;
  let report = validateSchemaDraft(value);
  assert.equal(report.issues[0].code, 'dimension_mismatch');
  assert.equal(funnelIssueTarget(JSON.stringify(value), report.issues[0]), 'schema-funnel-0-dimensions');
  assert.ok(funnelWarnings(readFunnelForm(JSON.stringify(value)), 0).some(w => w.field === 'dimensions'));
  value.funnels[0].dimensions.push('missing');
  assert.ok(funnelDimensionChoices(readFunnelForm(JSON.stringify(value)), 0).includes('missing'));
  const cleared = changeFunnelForm(JSON.stringify(value), action('dimensions', { value: [] }));
  assert.equal(validateSchemaDraft(JSON.parse(cleared)).valid, true);
  for (const dims of [['a', 'b', 'c', 'd', 'e'], ['kind', 'kind'], ['Invalid']])
    assert.throws(() => changeFunnelForm(text(), action('dimensions', { value: dims })));
});
test('funnel IDs, 10 funnel/step limits and shared 32KiB byte budget are enforced without mutation', () => {
  const original = text(); let next = original;
  for (let i = 1; i < 10; i++) next = changeFunnelForm(next, { kind: 'add' });
  assert.throws(() => changeFunnelForm(next, { kind: 'add' }));
  assert.throws(() => changeFunnelForm(next, { kind: 'edit', index: 1, field: 'id', value: 'conversion' }));
  assert.equal(JSON.parse(next).funnels[1].id, 'funnel_1');
  next = original; for (let i = 4; i < 10; i++) next = changeFunnelForm(next, action('add-step'));
  assert.throws(() => changeFunnelForm(next, action('add-step')));
  assert.throws(() => changeFunnelForm(original, action('edit', { field: 'label', value: '한'.repeat(12000) })));
  assert.throws(() => changeFunnelForm(original, { kind: 'remove', index: 1.2 }));
  const removed = JSON.parse(changeFunnelForm(original, action('remove')));
  assert.deepEqual(removed, { ...draft(), funnels: [] });
});
test('malformed JSON falls back; representable unfinished definitions can be repaired and focused', () => {
  for (const bad of ['{', '{"events":[],"workflows":[],"funnels":null}', JSON.stringify({ ...draft(), funnels: [{ id: 'x', label: 'x', steps: [{ eventName: 'x', source: 'other' }], dimensions: [] }] })]) {
    assert.throws(() => readFunnelForm(bad));
    assert.equal(funnelIssueTarget(bad, { path: '/funnels/0', code: 'invalid_definition' }), null);
  }
  const value = draft(); value.funnels[0].steps = [];
  let next = JSON.stringify(value), report = validateSchemaDraft(value);
  assert.equal(funnelIssueTarget(next, report.issues[0]), 'schema-funnel-0-add-step');
  next = changeFunnelForm(next, action('add-step')); next = changeFunnelForm(next, action('add-step'));
  next = changeFunnelForm(next, action('event', { step: 0, eventName: 'file_selected', source: 'browser' }));
  next = changeFunnelForm(next, action('event', { step: 1, eventName: 'job_finished', source: 'server' }));
  assert.equal(validateSchemaDraft(JSON.parse(next)).valid, true);
  for (const [patch, suffix] of [[{ id: 'Invalid' }, 'id'], [{ label: '' }, 'label']]) {
    const invalid = draft(); Object.assign(invalid.funnels[0], patch);
    assert.equal(funnelIssueTarget(JSON.stringify(invalid), validateSchemaDraft(invalid).issues[0]), `schema-funnel-0-${suffix}`);
  }
  assert.equal(funnelIssueTarget(text(), { path: '/events/0', code: 'invalid_definition' }), null);
  assert.equal(funnelFocusAfterChange({ kind: 'add' }, 1), 'schema-funnel-1-id');
  assert.equal(funnelFocusAfterChange(action('remove'), 1), 'schema-funnel-add');
  assert.equal(funnelFocusAfterChange(action('move-step', { step: 1, direction: 1 }), 1, 4), 'schema-funnel-0-step-2-event');
  assert.equal(funnelFocusAfterChange(action('remove-step', { step: 3 }), 1, 4), 'schema-funnel-0-step-2-event');
});
