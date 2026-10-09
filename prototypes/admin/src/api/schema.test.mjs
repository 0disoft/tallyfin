import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { SchemaEditor } from './schema-editor.ts';
import { definitionHash, parseSchemaValidation, parseSchemaPage } from './schema-contract.ts';

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
