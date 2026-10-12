import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './client.ts';
import { SchemaEditor } from './schema-editor.ts';

// Synthetic client ports isolate UI callback failures from authentication and HTTP.
const definitions = { events: [{ name: 'completed', label: 'Completed', source: 'browser', properties: {} }], workflows: [] };
const metadata = version => ({ schemaVersion: version, schemaStatus: 'active', publishedAt: '2026-10-12T00:00:00.000Z' });
const broken = () => { throw Error('private UI detail'); };
function fixture(onAccessLost) {
  const config = { owner: true, denied: false, offline: false, writes: 0, version: 1 };
  const client = {
    async getSettings() {
      if (config.offline) throw Error('offline');
      return { project: { id: 'sample' }, canEdit: config.owner };
    },
    async listSchemas() {
      return { latestVersion: config.version, data: [metadata(config.version)], page: { beforeVersion: null } };
    },
    async getSchema() { return structuredClone(definitions); },
    async validateSchema() {
      if (config.denied) throw new ApiError('forbidden', 'Access denied');
      return { valid: true, issues: [], privacyReviewRequired: true };
    },
    async publishSchema(_project, version) { config.writes++; config.version = version; return metadata(version); },
  };
  return { config, editor: new SchemaEditor(client, 'sample', onAccessLost) };
}

test('schema: failed initial and loading notifications do not block other subscribers or reads', async () => {
  const { editor } = fixture();
  try {
    assert.doesNotThrow(() => editor.subscribe(broken));
    const phases = []; editor.subscribe(state => phases.push(state.phase));
    await assert.doesNotReject(editor.load());
    assert.deepEqual(phases, ['loading', 'loading', 'ready']);
    assert.equal(editor.canEdit, true);
    assert.ok(!JSON.stringify(editor.state).includes('private UI detail'));
  } finally { editor.destroy(); }
});

test('schema: validation notification failure preserves a confirmed report and publication eligibility', async () => {
  const { editor } = fixture();
  try {
    await editor.load();
    editor.subscribe(state => { if (state.report?.valid) broken(); });
    const reports = []; editor.subscribe(state => { if (state.report) reports.push(state.report); });
    await assert.doesNotReject(editor.validate());
    assert.equal(editor.state.phase, 'ready');
    assert.equal(editor.state.report?.valid, true);
    assert.equal(editor.state.validatedKey, editor.state.target + '\n' + editor.state.draft);
    assert.equal(reports.length, 1);
    editor.setPrivacy(true);
    assert.equal(editor.state.privacyReviewed, true);
  } finally { editor.destroy(); }
});

test('schema: confirmed publication stays confirmed when a subscriber throws, without another PUT', async () => {
  const { editor, config } = fixture();
  try {
    await editor.load(); await editor.validate(); editor.setPrivacy(true);
    editor.subscribe(state => { if (state.snapshot?.page.latestVersion === 2) broken(); });
    const versions = []; editor.subscribe(state => versions.push(state.snapshot?.page.latestVersion));
    await assert.doesNotReject(editor.publish());
    assert.equal(config.writes, 1);
    assert.equal(editor.state.phase, 'ready');
    assert.equal(editor.state.pending, null);
    assert.equal(editor.state.target, '3');
    assert.equal(editor.hasDraftChanges, false);
    assert.equal(versions.at(-1), 2);
    await editor.publish(); assert.equal(config.writes, 1);
  } finally { editor.destroy(); }
});

test('schema: subscriber and access callback failures cannot interrupt revocation or repeat its signal', async () => {
  let lost = 0;
  const { editor, config } = fixture(() => { lost++; broken(); });
  try {
    await editor.load();
    const draft = JSON.stringify({ ...definitions, events: [{ ...definitions.events[0], label: 'My retained draft' }] });
    editor.edit('draft', draft);
    editor.subscribe(state => { if (state.blocked) broken(); });
    const blocked = []; editor.subscribe(state => blocked.push(state.blocked));
    config.denied = true;
    await assert.doesNotReject(editor.validate());
    assert.equal(lost, 1); assert.equal(blocked.at(-1), true);
    assert.equal(editor.canEdit, false); assert.equal(editor.state.phase, 'review');
    assert.equal(editor.state.draft, draft);
    config.offline = true; await assert.doesNotReject(editor.checkLatest());
    assert.equal(lost, 1); assert.equal(editor.canEdit, false);
    config.offline = false; await editor.checkLatest(); editor.keepDraft();
    assert.equal(editor.canEdit, true); assert.equal(editor.state.draft, draft);
    await assert.doesNotReject(editor.validate());
    assert.equal(lost, 2); assert.equal(editor.canEdit, false);
    assert.equal(config.writes, 0);
  } finally { editor.destroy(); }
});

test('schema: disposal during notification prevents later callbacks and post-disposal subscriptions', async () => {
  const { editor } = fixture();
  let later = 0;
  editor.subscribe(state => { if (state.phase === 'ready') editor.destroy(); });
  editor.subscribe(state => { if (state.phase === 'ready') later++; });
  await editor.load();
  editor.subscribe(() => { later++; });
  await editor.validate(); await editor.publish();
  assert.equal(later, 0);
});
