import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { SavedDraftController } from './saved-draft-controller.ts';
import { parseDraftSnapshot } from './saved-draft-contract.ts';
import { installUnloadWarning } from '../useUnloadWarning.ts';

const content = () => ({ targetVersion: '', draftText: '{미완성 한글' });
const snapshot = (draft = { ...content(), revision: 'a'.repeat(32), updatedAt: '2026-10-24T00:00:00.000Z' }) => ({ projectId: 'sample', draft });
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('unload checks the current saved state even before React removes an old warning effect', () => {
  const target = new EventTarget(); let dirty = true;
  const remove = installUnloadWarning(target, () => dirty);
  const before = new Event('beforeunload', { cancelable: true }); target.dispatchEvent(before); assert.equal(before.defaultPrevented, true);
  dirty = false;
  const saved = new Event('beforeunload', { cancelable: true }); target.dispatchEvent(saved); assert.equal(saved.defaultPrevented, false);
  remove();
});

test('wire parser is closed, preserves empty/unfinished input and rejects invalid identity, limits and approval', () => {
  assert.deepEqual(parseDraftSnapshot(snapshot()), snapshot()); assert.deepEqual(parseDraftSnapshot(snapshot(null)), snapshot(null));
  for (const invalid of [{ ...snapshot(), extra: true }, snapshot({ ...snapshot().draft, privacyReviewed: true }), snapshot({ ...snapshot().draft, revision: '' }),
    snapshot({ ...snapshot().draft, targetVersion: 'x'.repeat(33) }), snapshot({ ...snapshot().draft, draftText: '한'.repeat(131072) }),
    snapshot({ ...snapshot().draft, updatedAt: 'yesterday' })]) assert.throws(() => parseDraftSnapshot(invalid));
});

test('client uses protected same-origin GET/PUT, snapshots submitted strings and validates the response', async () => {
  const calls = [], held = deferred();
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'PUT') { await held.promise; return response(snapshot()); }
    return response(snapshot(null));
  } });
  try {
    assert.deepEqual(await client.getSchemaDraft('sample'), snapshot(null));
    const input = { ...content(), expectedRevision: null }, pending = client.saveSchemaDraft('sample', input);
    input.draftText = 'edited after submission'; held.resolve(); await pending;
    assert.equal(calls.length, 2); assert.equal(calls[1].url, '/v1/projects/sample/schemas/draft');
    assert.equal(JSON.parse(calls[1].options.body).draftText, content().draftText);
    assert.equal(calls[1].options.cache, 'no-store');
    await assert.rejects(client.saveSchemaDraft('sample', { ...content(), expectedRevision: 'bad' }), error => error.kind === 'invalid_request');
    assert.equal(calls.length, 2);
  } finally { client.destroy(); }
});

test('client rejects cross-project, mismatched write results and surfaces draft conflicts separately from publication', async () => {
  for (const body of [{ ...snapshot(), projectId: 'other' }, snapshot({ ...snapshot().draft, draftText: 'different' }), snapshot(null)]) {
    const client = new ApiClient({ token: 'not-a-credential', fetchImpl: async () => response(body) });
    try { await assert.rejects(client.saveSchemaDraft('sample', { ...content(), expectedRevision: null }), error => error.kind === 'contract'); }
    finally { client.destroy(); }
  }
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl: async () => response({ error: { code: 'schema_draft_conflict' } }, 409) });
  try { await assert.rejects(client.saveSchemaDraft('sample', { ...content(), expectedRevision: null }), error => error.kind === 'schema_draft_conflict'); }
  finally { client.destroy(); }
});

test('controller requires a prior read, takes its CAS revision, blocks duplicate saves and retains edits made in flight', async () => {
  const held = deferred(), calls = [];
  const controller = new SavedDraftController({ getSchemaDraft: async () => snapshot(null), saveSchemaDraft: async (_id, input) => { calls.push(input); return held.promise; } }, 'sample');
  await controller.save(content()); assert.equal(calls.length, 0);
  await controller.load(); const input = content(), save = controller.save(input); input.draftText = 'new local text';
  await controller.save(input); assert.equal(calls.length, 1); assert.equal(calls[0].expectedRevision, null);
  held.resolve(snapshot()); await save;
  assert.equal(controller.state.confirmed.draftText, content().draftText); assert.equal(input.draftText, 'new local text');
  controller.destroy();
});

test('uncertain committed save is never retried and a readback confirms the submitted content', async () => {
  let writes = 0, saved = snapshot(null);
  const controller = new SavedDraftController({ getSchemaDraft: async () => saved, saveSchemaDraft: async () => {
    writes++; saved = snapshot(); throw new ApiError('network', 'lost response');
  } }, 'sample');
  await controller.load(); await controller.save(content()); await controller.save(content());
  assert.equal(writes, 1); assert.equal(controller.state.reviewRequired, true); assert.equal(controller.state.snapshot, null);
  await controller.load(); assert.equal(controller.state.reviewRequired, false); assert.deepEqual(controller.state.confirmed, content());
  assert.equal(writes, 1); controller.destroy();
});

test('conflict keeps the current draft until fresh read and explicit review; accepting review never writes', async () => {
  let writes = 0;
  const controller = new SavedDraftController({ getSchemaDraft: async () => snapshot({ ...snapshot().draft, draftText: 'other owner' }),
    saveSchemaDraft: async () => { writes++; throw new ApiError('schema_draft_conflict', 'conflict'); } }, 'sample');
  await controller.load(); await controller.save(content()); await controller.load();
  assert.equal(controller.state.reviewRequired, true); assert.equal(controller.state.pending.draftText, content().draftText);
  await controller.save(content()); assert.equal(writes, 1);
  controller.acceptReview(); assert.equal(writes, 1); assert.equal(controller.state.reviewRequired, false); controller.destroy();
});

test('suspension aborts writes, requires readback and ignores late success; destroy also ignores late read failures', async () => {
  const held = deferred(), read = deferred(); let signal;
  const controller = new SavedDraftController({ getSchemaDraft: async () => snapshot(null), saveSchemaDraft: async (_id, _input, options) => { signal = options.signal; return held.promise; } }, 'sample');
  await controller.load(); const save = controller.save(content()); controller.suspend();
  assert.equal(signal.aborted, true); held.resolve(snapshot()); await save;
  assert.equal(controller.state.snapshot, null); assert.equal(controller.state.reviewRequired, true);
  controller.destroy();
  const other = new SavedDraftController({ getSchemaDraft: () => read.promise }, 'sample'); const pending = other.load();
  other.destroy(); const state = other.state; read.reject(Error('late')); await pending; assert.equal(other.state, state);
});
