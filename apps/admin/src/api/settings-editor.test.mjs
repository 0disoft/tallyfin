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

test('unload protection follows raw draft changes, pending saves, readback and disposal', async () => {
  let finish, current = settings();
  const editor = new SettingsEditor({ getSettings: async () => current,
    updateSettings: () => new Promise(resolve => { finish = resolve; }) }, 'example');
  assert.equal(editor.hasUnsavedChanges, false);
  await editor.load(); assert.equal(editor.hasUnsavedChanges, false);
  editor.edit('name', 'Draft'); assert.equal(editor.hasUnsavedChanges, true);
  editor.edit('name', 'Original'); assert.equal(editor.hasUnsavedChanges, false);
  editor.edit('name', 'Saved'); const saving = editor.save();
  assert.equal(editor.state.phase, 'saving'); assert.equal(editor.hasUnsavedChanges, true);
  finish(current = settings('Saved')); await saving;
  assert.equal(editor.hasUnsavedChanges, false);
  editor.edit('name', 'Later'); await editor.checkLatest();
  assert.equal(editor.hasUnsavedChanges, true);
  editor.useServer(); assert.equal(editor.hasUnsavedChanges, false);
  editor.edit('name', 'Disposed draft'); editor.destroy();
  assert.equal(editor.hasUnsavedChanges, false);
});

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
  assert.deepEqual(editor.state.snapshot, saved);
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
  assert.deepEqual(editor.state.snapshot, current);
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
    assert.deepEqual(editor.state.snapshot, current);
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
  assert.deepEqual(editor.state.snapshot, current);
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

// State is an observer view. Neither API results nor observer callbacks own it.
test('editor owns snapshots and rejects mutation through state, subscriptions and saved callbacks', async () => {
  const source = settings(); source.allowedOrigins.push('https://example.invalid');
  let notification;
  const editor = new SettingsEditor({ getSettings: async () => source }, 'example', saved => {
    saved.project.name = 'Callback mutation'; saved.allowedOrigins.length = 0;
  });
  editor.subscribe(state => { notification = state; });
  await editor.load();
  assert.notEqual(editor.state.snapshot, source);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.project), false);
  source.project.name = 'External mutation'; source.limits.requestsPerMinute = 1; source.allowedOrigins.length = 0;
  assert.equal(editor.state.snapshot.project.name, 'Original');
  assert.equal(editor.state.snapshot.limits.requestsPerMinute, 120);
  assert.deepEqual(editor.state.snapshot.allowedOrigins, ['https://example.invalid']);
  assert.throws(() => { editor.state = {}; }, TypeError);
  assert.throws(() => { notification.phase = 'saving'; }, TypeError);
  assert.throws(() => { notification.snapshot.project.name = 'Observer mutation'; }, TypeError);
  assert.throws(() => { notification.snapshot.allowedOrigins.push('https://other.invalid'); }, TypeError);
  assert.throws(() => { notification.draft.name = 'Observer mutation'; }, TypeError);
  assert.throws(() => { notification.errors.name = 'Observer mutation'; }, TypeError);
  editor.edit('name', 'Draft'); assert.equal(editor.state.draft.name, 'Draft');
  assert.equal(notification.draft.name, 'Draft');
  editor.destroy();
});
