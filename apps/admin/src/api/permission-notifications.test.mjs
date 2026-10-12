import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './client.ts';
import { GrantEditor } from './grant-editor.ts';
import { PublisherEditor } from './publisher-editor.ts';

// Synthetic client ports isolate notification faults from HTTP authentication.
const identity = { issuer: 'https://identity.example.invalid', subject: 'test-account' };
const broken = () => { throw new Error('private UI detail'); };
const cases = [
  { name: 'grant', Editor: GrantEditor, method: 'changeGrant',
    input: { ...identity, role: 'reader', expectedRole: null },
    result: { ...identity, projectId: 'example', role: 'reader', createdAt: '2026-10-12T00:00:00.000Z', canManage: true, changed: true } },
  { name: 'publisher', Editor: PublisherEditor, method: 'changePublisher',
    input: { ...identity, granted: true },
    result: { ...identity, projectId: 'example', granted: true, grantId: 'a'.repeat(32), createdAt: '2026-10-12T00:00:00.000Z', changed: true } },
];

for (const { name, Editor, method, input, result } of cases) {
  test(`${name}: failed subscriptions cannot block confirmed writes or cause replay`, async () => {
    let writes = 0, saved = 0;
    const editor = new Editor({ [method]: async () => { writes++; return result; } }, 'example',
      { onSaved: () => { saved++; broken(); } });
    const delivered = [];
    assert.doesNotThrow(() => editor.subscribe(broken));
    editor.subscribe(state => delivered.push(state.phase));
    assert.equal(editor.prepare(input), true);
    await assert.doesNotReject(editor.confirm());
    assert.equal(editor.state.phase, 'success');
    assert.equal(saved, 1);
    assert.deepEqual(delivered, ['idle', 'review', 'saving', 'success']);
    await editor.confirm();
    assert.equal(writes, 1);
    assert.ok(!JSON.stringify(editor.state).includes('private UI detail'));
    editor.destroy();
  });

  test(`${name}: failed denied-state subscriber cannot skip access-loss notification`, async () => {
    let writes = 0, lost = 0;
    const editor = new Editor({ [method]: async () => {
      writes++; throw new ApiError('forbidden', 'Access denied');
    } }, 'example', { onAccessLost: () => { lost++; broken(); } });
    editor.subscribe(state => { if (state.phase === 'denied') broken(); });
    assert.equal(editor.prepare(input), true);
    await assert.doesNotReject(editor.confirm());
    assert.equal(editor.state.phase, 'denied');
    assert.equal(lost, 1);
    assert.equal(editor.prepare(input), false);
    await editor.confirm();
    assert.equal(writes, 1);
    editor.destroy();
  });
}
