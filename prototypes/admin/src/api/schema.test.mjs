import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { SchemaEditor } from './schema-editor.ts';
import { definitionHash, parseSchemaValidation, parseSchemaPage } from './schema-contract.ts';
import { changeEventForm, eventIsLinked, eventIssueTarget, readEventForm } from './schema-event-form.ts';
import { changePropertyForm, propertyChoices, propertyIsDimension, propertyIssueTarget, readPropertyForm } from './schema-property-form.ts';
import { validateSchemaDraft } from '../../../../packages/core/src/schema.ts';

const definitions = () => ({ events: [{ name: 'operation_completed', label: '작업 완료', source: 'browser', properties: {} }], workflows: [] });
const metadata = version => ({ schemaVersion: version, schemaStatus: 'active', publishedAt: '2026-10-09T00:00:00.000Z' });
const project = { id: 'sample', name: 'Sample', status: 'active', timeZone: 'Asia/Seoul' };
const registry = (version, draft) => ({ project, ...metadata(version), allowedOrigins: ['https://example.invalid'],
  limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, ...draft });
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fixture() {
  const calls = [], schemas = new Map([[1, definitions()]]);
  const config = { owner: true, write: null, validate: null };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PUT') {
      if (config.write) return config.write(url, init);
      const version = Number(url.split('/').at(-1)), input = JSON.parse(init.body), draft = { events: input.events, workflows: input.workflows };
      schemas.set(version, draft);
      return response(200, { projectId: 'sample', ...metadata(version), definitionHash: await definitionHash(draft) });
    }
    if (init.method === 'POST') return config.validate ? config.validate(url, init) : response(200, { valid: true, issues: [], privacyReviewRequired: true });
    if (url === '/v1/projects/sample') return response(200, { project, allowedOrigins: ['https://example.invalid'],
      limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, settingsHash: 'a'.repeat(64), canEdit: config.owner });
    if (url.includes('/schemas?')) {
      const versions = [...schemas.keys()].sort((a, b) => b - a);
      return response(200, { projectId: 'sample', latestVersion: versions[0] ?? null, data: versions.map(metadata), page: { limit: 25, beforeVersion: null } });
    }
    const version = Number(url.split('/').at(-1));
    return schemas.has(version) ? response(200, registry(version, schemas.get(version))) : response(404, { error: { code: 'not_found' } });
  };
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl }), editor = new SchemaEditor(client, 'sample');
  return { client, editor, calls, schemas, config };
}
const ready = async editor => { await editor.load(); await editor.validate(); editor.setPrivacy(true); };
test('schema client uses explicit POST/PUT and checks response identity/hash with protected transport', async () => {
  const f = fixture(); await ready(f.editor); await f.editor.publish();
  const write = f.calls.find(c => c.init.method === 'PUT');
  assert.equal(write.url, '/v1/projects/sample/schemas/2');
  assert.deepEqual(JSON.parse(write.init.body), { ...definitions(), expectedLatestVersion: 1, privacyReviewed: true });
  assert.equal(write.init.credentials, 'omit'); assert.equal(write.init.cache, 'no-store'); assert.equal(write.init.referrerPolicy, 'no-referrer');
  assert.equal(f.editor.state.snapshot.page.latestVersion, 2); assert.equal(f.editor.state.target, '3');
  f.config.write = async () => response(200, { projectId: 'sample', ...metadata(3), definitionHash: 'b'.repeat(64) });
  await assert.rejects(f.client.publishSchema('sample', 3, { ...definitions(), expectedLatestVersion: 2, privacyReviewed: true }), e => e instanceof ApiError && e.kind === 'contract');
  f.editor.destroy(); f.client.destroy();
});
test('changing definitions/version invalidates validation and privacy; invalid JSON and semantic errors never publish', async () => {
  const f = fixture(); await ready(f.editor);
  f.editor.edit('target', '3'); await f.editor.publish(); assert.equal(f.calls.some(c => c.init.method === 'PUT'), false);
  await f.editor.validate(); f.editor.setPrivacy(true); f.editor.edit('draft', '{'); await f.editor.validate();
  assert.ok(f.editor.state.formError); assert.equal(f.editor.state.validatedKey, null);
  f.editor.edit('draft', JSON.stringify(definitions()));
  f.config.validate = async () => response(200, { valid: false, issues: [{ path: '/events/0', code: 'invalid_definition' }], privacyReviewRequired: true });
  await f.editor.validate(); f.editor.setPrivacy(true); await f.editor.publish();
  assert.equal(f.calls.some(c => c.init.method === 'PUT'), false); f.editor.destroy();
});
test('409 preserves draft until explicit latest review and validation with a new version', async () => {
  const f = fixture(); await f.editor.load();
  const mine = definitions(); mine.events[0].label = '내 정의'; f.editor.edit('draft', JSON.stringify(mine));
  f.config.write = async () => { f.schemas.set(2, definitions()); return response(409, { error: { code: 'schema_conflict' } }); };
  await f.editor.validate(); f.editor.setPrivacy(true); await f.editor.publish();
  assert.equal(f.editor.state.phase, 'review'); assert.equal(f.editor.state.draft, JSON.stringify(mine));
  await f.editor.publish(); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  await f.editor.checkLatest(); assert.equal(f.editor.state.latest.page.latestVersion, 2);
  f.editor.keepDraft(); assert.equal(f.editor.state.target, '3'); assert.equal(f.editor.state.draft, JSON.stringify(mine));
  assert.equal(f.editor.state.validatedKey, null); f.editor.destroy();
});
test('read-back confirms a committed write after a lost response without retransmission', async () => {
  const f = fixture(); await ready(f.editor);
  f.config.write = async (_url, init) => { const v = JSON.parse(init.body); f.schemas.set(2, { events: v.events, workflows: v.workflows }); throw new TypeError('response dropped'); };
  const draft = f.editor.state.draft; await f.editor.publish(); await f.editor.checkLatest();
  assert.equal(f.editor.state.phase, 'ready'); assert.equal(f.editor.state.pending, null); assert.equal(f.editor.state.draft, draft);
  assert.match(f.editor.state.message, /서버에서 확인/); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1); f.editor.destroy();
});
test('reader and revoked owner cannot edit/publish, and refresh does not silently overwrite drafts', async () => {
  const f = fixture(); f.config.owner = false; await f.editor.load();
  const original = f.editor.state.draft; f.editor.edit('draft', '{}'); await f.editor.validate(); await f.editor.publish();
  assert.equal(f.editor.state.draft, original); assert.equal(f.calls.some(c => c.init.method !== 'GET'), false);
  f.config.owner = true; await f.editor.refresh(); f.editor.edit('draft', JSON.stringify(definitions()));
  await f.editor.refresh(); assert.equal(f.editor.state.phase, 'review'); assert.equal(f.editor.state.draft, JSON.stringify(definitions()));
  f.editor.keepDraft(); await f.editor.validate(); f.editor.setPrivacy(true);
  f.config.write = async () => { f.config.owner = false; return response(403, { error: { code: 'forbidden' } }); };
  await f.editor.publish(); await f.editor.checkLatest(); f.editor.keepDraft(); assert.equal(f.editor.state.phase, 'review');
  f.editor.useServer(); assert.equal(f.editor.canEdit, false); f.editor.destroy();
});
test('destroyed controllers ignore late validation replies and do not issue writes', async () => {
  const f = fixture(); await f.editor.load(); let release;
  f.config.validate = async () => new Promise(resolve => { release = resolve; });
  const pending = f.editor.validate(); await new Promise(resolve => setTimeout(resolve, 0));
  f.editor.destroy(); release(response(200, { valid: true, issues: [], privacyReviewRequired: true })); await pending;
  assert.equal(f.editor.state.validatedKey, null); assert.equal(f.calls.some(c => c.init.method === 'PUT'), false);
});
test('response validators reject inconsistent reports, unordered/foreign cursors and malformed metadata', async () => {
  for (const input of [{ valid: true, issues: [{ path: '', code: 'duplicate' }], privacyReviewRequired: true },
    { valid: false, issues: [{ path: '/private-input', code: 'duplicate' }], privacyReviewRequired: true }]) assert.throws(() => parseSchemaValidation(input));
  assert.throws(() => parseSchemaPage({ projectId: 'sample', latestVersion: 2, data: [metadata(1), metadata(2)], page: { limit: 25, beforeVersion: null } }));
});

test('event form edits preserve properties, workflows and unsupported event keys without repairing the draft', () => {
  const draft = definitions();
  draft.events[0].properties = { category: { type: 'enum', required: true, purpose: 'Public category', values: ['one', 'two'] } };
  draft.events[0].extra = { preserve: true };
  draft.workflows.push({ id: 'unrelated', startEvent: 'different', successEvent: 'other', dimensions: ['category'] });
  const original = JSON.stringify(draft);
  const edited = JSON.parse(changeEventForm(original, { kind: 'edit', index: 0, field: 'label', value: '새 표시 이름' }));
  assert.deepEqual(edited.events[0], { ...draft.events[0], label: '새 표시 이름' });
  assert.deepEqual(edited.workflows, draft.workflows);
  const added = changeEventForm(JSON.stringify(edited), { kind: 'add' });
  assert.deepEqual(JSON.parse(added).events[1], { name: '', label: '', source: 'browser', properties: {} });
  assert.deepEqual(JSON.parse(changeEventForm(added, { kind: 'remove', index: 1 })), edited);
  assert.equal(JSON.parse(original).events[0].label, '작업 완료');
});

test('linked event identity/source/deletion are protected while its label remains editable', () => {
  const draft = definitions(); draft.workflows.push({ id: 'flow', startEvent: 'start', successEvent: 'operation_completed', failureEvent: null, dimensions: [] });
  const text = JSON.stringify(draft); assert.equal(eventIsLinked(readEventForm(text), 0), true);
  for (const action of [{ kind: 'remove', index: 0 }, { kind: 'edit', index: 0, field: 'name', value: 'renamed' }, { kind: 'edit', index: 0, field: 'source', value: 'server' }])
    assert.throws(() => changeEventForm(text, action), /작업 흐름/);
  assert.deepEqual(JSON.parse(changeEventForm(text, { kind: 'edit', index: 0, field: 'label', value: '새 이름' })).workflows, draft.workflows);
});

test('unsupported JSON and event count/byte limits never produce a replacement draft; errors retain a usable focus target', () => {
  for (const text of ['{', '{"events":[null],"workflows":[]}', '{"events":[{"name":"a","label":"a","source":"unexpected","properties":{}}],"workflows":[]}'])
    assert.throws(() => changeEventForm(text, { kind: 'add' }));
  const full = JSON.stringify({ events: Array.from({ length: 50 }, (_, i) => ({ name: `event_${i}`, label: 'Event', source: 'browser', properties: {} })), workflows: [] });
  assert.throws(() => changeEventForm(full, { kind: 'add' }));
  assert.throws(() => changeEventForm(JSON.stringify(definitions()), { kind: 'edit', index: 0, field: 'label', value: 'a'.repeat(32768) }));
  assert.throws(() => changeEventForm(JSON.stringify(definitions()), { kind: 'remove', index: -1 }));
  assert.equal(eventIssueTarget('{', { path: '/events/0', code: 'invalid_definition' }), null);
  assert.equal(eventIssueTarget(JSON.stringify(definitions()), { path: '/events/0/name', code: 'duplicate' }), 'schema-event-0-name');
  assert.equal(eventIssueTarget(JSON.stringify(definitions()), { path: '/events/0/properties', code: 'invalid_definition' }), null);
  assert.equal(eventIssueTarget('{"events":[],"workflows":[]}', { path: '/events', code: 'definition_limit' }), 'schema-event-add');
});

test('form changes go through the shared editor draft and invalidate prior approval; reader and review stay locked', async () => {
  const f = fixture(); await ready(f.editor);
  const changed = changeEventForm(f.editor.state.draft, { kind: 'edit', index: 0, field: 'label', value: '폼에서 변경' });
  f.editor.edit('draft', changed); assert.equal(f.editor.state.validatedKey, null); assert.equal(f.editor.state.privacyReviewed, false);
  await f.editor.publish(); assert.equal(f.calls.some(c => c.init.method === 'PUT'), false);
  await f.editor.validate(); f.editor.setPrivacy(true); await f.editor.publish();
  assert.equal(f.schemas.get(2).events[0].label, '폼에서 변경');
  f.editor.edit('draft', changeEventForm(f.editor.state.draft, { kind: 'add' }));
  await f.editor.refresh(); assert.equal(f.editor.state.phase, 'review'); const pending = f.editor.state.draft;
  f.editor.edit('draft', changeEventForm(pending, { kind: 'remove', index: 1 })); assert.equal(f.editor.state.draft, pending);
  f.editor.useServer();
  f.config.owner = false; await f.editor.refresh(); const saved = f.editor.state.draft;
  f.editor.edit('draft', changeEventForm(saved, { kind: 'add' })); assert.equal(f.editor.state.draft, saved);
  f.editor.destroy(); f.client.destroy();
});

test('property add/rename/edit/remove preserves other properties and workflows and cannot overwrite a name', () => {
  const draft = definitions(); draft.events[0].properties = { original: { type: 'boolean', required: true, purpose: 'Original', extra: { preserved: true } } };
  draft.workflows = [{ id: 'unrelated', dimensions: ['other'], startEvent: 'other', successEvent: 'done' }];
  const original = JSON.stringify(draft), added = changePropertyForm(original, 0, { kind: 'add' });
  let edited = changePropertyForm(added, 0, { kind: 'rename', name: 'property_1', value: 'format' });
  assert.throws(() => changePropertyForm(edited, 0, { kind: 'rename', name: 'format', value: 'original' }), /덮어쓰지/);
  edited = changePropertyForm(edited, 0, { kind: 'purpose', name: 'format', value: 'Public format' });
  assert.deepEqual(JSON.parse(edited).events[0].properties.original, draft.events[0].properties.original);
  assert.deepEqual(JSON.parse(edited).workflows, draft.workflows);
  assert.deepEqual(JSON.parse(changePropertyForm(edited, 0, { kind: 'remove', name: 'format' })), draft);
  assert.equal(JSON.parse(original).events[0].properties.format, undefined);
});

test('property type conversion preserves shared metadata, explicitly replaces only old type fields, and retains incomplete numeric/enum input', () => {
  const draft = definitions(); draft.events[0].properties = { field: { type: 'enum', required: true, purpose: 'Public category', values: ['one', 'two'], extra: true } };
  let edited = changePropertyForm(JSON.stringify(draft), 0, { kind: 'type', name: 'field', value: 'integer' });
  assert.deepEqual(JSON.parse(edited).events[0].properties.field, { type: 'integer', required: true, purpose: 'Public category', minimum: 0, maximum: 1, extra: true });
  for (const value of ['', '-', '9007199254740993', '0.5']) {
    const next = changePropertyForm(edited, 0, { kind: 'minimum', name: 'field', value });
    assert.equal(JSON.parse(next).events[0].properties.field.minimum, value);
    assert.equal(validateSchemaDraft(JSON.parse(next)).valid, false);
  }
  edited = changePropertyForm(edited, 0, { kind: 'type', name: 'field', value: 'enum' });
  edited = changePropertyForm(edited, 0, { kind: 'values', name: 'field', value: 'one\n\none' });
  assert.deepEqual(JSON.parse(edited).events[0].properties.field.values, ['one', '', 'one']);
  assert.equal(propertyChoices(JSON.parse(edited).events[0].properties.field), null);
});

test('workflow dimension properties lock identity and signature but permit purpose and unrelated properties', () => {
  const draft = definitions(); draft.events[0].properties = { category: { type: 'enum', required: true, purpose: 'Category', values: ['one'] }, other: { type: 'boolean', required: false, purpose: 'Flag' } };
  draft.workflows = [{ id: 'flow', startEvent: 'start', successEvent: 'operation_completed', failureEvent: null, dimensions: ['category'] }];
  const text = JSON.stringify(draft); assert.equal(propertyIsDimension(readEventForm(text), 0, 'category'), true);
  for (const action of [{ kind: 'remove', name: 'category' }, { kind: 'rename', name: 'category', value: 'renamed' }, { kind: 'type', name: 'category', value: 'boolean' },
    { kind: 'required', name: 'category', value: false }, { kind: 'values', name: 'category', value: 'two' }])
    assert.throws(() => changePropertyForm(text, 0, action), /비교 기준/);
  const next = JSON.parse(changePropertyForm(text, 0, { kind: 'purpose', name: 'category', value: 'New purpose' }));
  assert.deepEqual(next.workflows, draft.workflows); assert.deepEqual(next.events[0].properties.category.values, ['one']);
  assert.equal(JSON.parse(changePropertyForm(text, 0, { kind: 'required', name: 'other', value: true })).events[0].properties.other.required, true);
});

test('property count, combinations and unsupported JSON retain server limits and focus mapping', () => {
  const draft = definitions(); draft.events[0].properties = Object.fromEntries(['a', 'b', 'c', 'd'].map(name => [name, { type: 'boolean', required: false, purpose: 'Flag' }]));
  const text = JSON.stringify(draft); assert.throws(() => changePropertyForm(text, 0, { kind: 'add' }));
  const bad = JSON.stringify({ ...draft, events: [{ ...draft.events[0], properties: { unsupported: { type: 'custom' } } }] });
  assert.throws(() => changePropertyForm(bad, 0, { kind: 'add' })); assert.throws(() => readPropertyForm(readEventForm(text), -1));
  assert.equal(propertyChoices({ type: 'integer', required: false, purpose: 'Range', minimum: 0, maximum: 31 }), 33);
  draft.events[0].properties.a = { type: 'integer', required: true, purpose: 'Range', minimum: 0, maximum: 31 };
  const cardinalityIssue = validateSchemaDraft(draft).issues[0]; assert.equal(cardinalityIssue.code, 'cardinality_limit');
  assert.equal(propertyIssueTarget(JSON.stringify(draft), cardinalityIssue), 'schema-event-0-properties-heading');
  assert.equal(propertyIssueTarget(JSON.stringify(draft), { path: '/events/0', code: 'cardinality_limit' }), 'schema-event-0-properties-heading');
  draft.events[0].properties.a.minimum = '';
  assert.equal(propertyIssueTarget(JSON.stringify(draft), { path: '/events/0/properties/a', code: 'invalid_definition' }), 'schema-event-0-property-0-minimum');
  assert.equal(propertyIssueTarget(bad, { path: '/events/0/properties/unsupported', code: 'invalid_definition' }), null);
});

test('valid property form output passes the actual core validator, invalid inputs cannot reuse publishing approval', async () => {
  const f = fixture(); await ready(f.editor);
  let next = changePropertyForm(f.editor.state.draft, 0, { kind: 'add' });
  next = changePropertyForm(next, 0, { kind: 'rename', name: 'property_1', value: 'format' });
  next = changePropertyForm(next, 0, { kind: 'type', name: 'format', value: 'enum' });
  next = changePropertyForm(next, 0, { kind: 'purpose', name: 'format', value: 'Public formats' });
  next = changePropertyForm(next, 0, { kind: 'values', name: 'format', value: 'pdf\npng' });
  assert.equal(validateSchemaDraft(JSON.parse(next)).valid, true);
  f.editor.edit('draft', next); assert.equal(f.editor.state.privacyReviewed, false); await f.editor.publish(); assert.equal(f.schemas.has(2), false);
  f.config.validate = async (_url, init) => response(200, validateSchemaDraft(JSON.parse(init.body)));
  await f.editor.validate(); f.editor.setPrivacy(true); await f.editor.publish(); assert.deepEqual(f.schemas.get(2).events[0].properties.format.values, ['pdf', 'png']);
  f.editor.edit('draft', changePropertyForm(f.editor.state.draft, 0, { kind: 'values', name: 'format', value: 'pdf\npdf' }));
  await f.editor.validate(); f.editor.setPrivacy(true); await f.editor.publish(); assert.equal(f.schemas.has(3), false);
  f.config.owner = false; await f.editor.refresh(); const saved = f.editor.state.draft;
  f.editor.edit('draft', changePropertyForm(saved, 0, { kind: 'remove', name: 'format' })); assert.equal(f.editor.state.draft, saved);
  f.editor.destroy(); f.client.destroy();
});
