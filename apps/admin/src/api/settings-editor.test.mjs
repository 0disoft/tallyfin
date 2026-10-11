import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsEditor } from './settings-editor.ts';
import { ApiError } from './client.ts';

const settings = (name = 'Original', canEdit = true) => ({
  project: { id: 'example', name, status: 'active', timeZone: 'UTC' },
  allowedOrigins: [], limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 },
  settingsHash: (name === 'Original' ? 'a' : 'b').repeat(64), canEdit,
});
const brokenNotification = () => { throw new Error('private UI detail'); };

test('a failed saved notification cannot invalidate a confirmed write or replay it', async () => {
  let writes = 0, notifications = 0;
  const saved = settings('Saved');
  const editor = new SettingsEditor({
    getSettings: async () => settings(),
    updateSettings: async () => { writes++; return saved; },
  }, 'example', () => { if (++notifications > 1) brokenNotification(); });
  await editor.load();
  assert.equal(editor.state.phase, 'ready');
  editor.edit('name', 'Saved');
  await editor.save();
  assert.equal(editor.state.phase, 'ready');
  assert.equal(editor.state.snapshot, saved);
  assert.equal(editor.state.draft.name, 'Saved');
  assert.equal(editor.state.message, '프로젝트 설정을 저장했어요.');
  await editor.save();
  assert.equal(writes, 1);
  assert.ok(!JSON.stringify(editor.state).includes('private UI detail'));
  editor.destroy();
});

test('a failed saved notification cannot invalidate a confirmed read', async () => {
  const current = settings();
  const editor = new SettingsEditor({ getSettings: async () => current }, 'example', brokenNotification);
  await editor.load();
  assert.equal(editor.state.phase, 'ready');
  assert.equal(editor.state.snapshot, current);
  assert.equal(editor.state.message, null);
  editor.destroy();
});

test('explicit server adoption and rebasing keep their result when the notification fails', async () => {
  for (const choice of ['useServer', 'keepChanges']) {
    let current = settings();
    const editor = new SettingsEditor({ getSettings: async () => current }, 'example', brokenNotification);
    await editor.load();
    editor.edit('name', 'Draft');
    current = settings('Remote');
    await editor.checkLatest();
    assert.equal(editor.state.phase, 'review');
    assert.doesNotThrow(() => editor[choice]());
    assert.equal(editor.state.phase, 'ready');
    assert.equal(editor.state.snapshot, current);
    assert.equal(editor.state.latest, null);
    assert.equal(editor.state.draft.name, choice === 'useServer' ? 'Remote' : 'Draft');
    editor.destroy();
  }
});

test('a failing subscriber does not block other subscribers or the revoked-owner notification', async () => {
  let loss = 0;
  let current = settings();
  const delivered = [];
  const editor = new SettingsEditor({ getSettings: async () => current }, 'example', undefined,
    () => { loss++; brokenNotification(); });
  editor.subscribe(brokenNotification);
  editor.subscribe(state => delivered.push(state));
  await editor.load();
  assert.equal(editor.state.phase, 'ready');
  current = settings('Remote', false);
  await editor.refresh();
  assert.equal(editor.state.phase, 'ready');
  assert.equal(editor.state.snapshot, current);
  assert.equal(editor.state.blocked, true);
  assert.equal(loss, 1);
  assert.equal(delivered.at(-1), editor.state);
  await editor.refresh();
  assert.equal(loss, 1);
  editor.destroy();
});

test('notification failure leaves denied saves locked with the original draft and no extra write', async () => {
  let loss = 0, writes = 0;
  const editor = new SettingsEditor({
    getSettings: async () => settings(),
    updateSettings: async () => { writes++; throw new ApiError('forbidden'); },
  }, 'example', undefined, () => { loss++; brokenNotification(); });
  await editor.load(); editor.edit('name', 'Draft');
  await assert.doesNotReject(editor.save());
  assert.equal(editor.state.phase, 'review');
  assert.equal(editor.state.blocked, true);
  assert.equal(editor.state.draft.name, 'Draft');
  assert.equal(loss, 1);
  await editor.save();
  assert.equal(writes, 1);
  assert.ok(!JSON.stringify(editor.state).includes('private UI detail'));
  editor.destroy();
});
