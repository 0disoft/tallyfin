import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from './client.ts';
import { ProjectCreator } from './project-creator.ts';
import { creationHash, creationInput, parseCreatedProject } from './project-creation.ts';
import { projectCreationHash, parseProjectCreation } from '../../../../packages/core/src/project-creation.ts';
import { sdkSetup } from './sdk-setup.ts';
import { projectBrowserSchema } from '../../../../tools/browser/schema.mjs';
import { readFileSync } from 'node:fs';

const input = { id: 'new-product', name: 'New product', timeZone: 'Asia/Seoul', allowedOrigins: ['https://z.example.invalid', 'https://a.example.invalid'],
  limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 } };
const draft = { id: input.id, name: input.name, timeZone: input.timeZone, origins: input.allowedOrigins.join('\n'), requestsPerMinute: '120', newReceiptsPerUtcDay: '100000' };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const receipt = async body => ({ projectId: body.id, createdAt: '2026-10-09T00:00:00.000Z', creationHash: await projectCreationHash(parseProjectCreation(body)) });
function fixture() {
  const calls = [], opened = [], config = { post: null, get: null };
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return config.post ? config.post(url, init) : response(200, await receipt(JSON.parse(init.body)));
    if (config.get) return config.get(url, init);
    return response(200, { project: { id: input.id, name: 'Current name', status: 'active', timeZone: 'Asia/Seoul' },
      allowedOrigins: input.allowedOrigins, limits: input.limits, settingsHash: 'a'.repeat(64), canEdit: true });
  } });
  const creator = new ProjectCreator(client, settings => opened.push(settings));
  for (const [key, value] of Object.entries(draft)) creator.edit(key, value);
  return { creator, client, calls, config, opened };
}

test('canceling the opened-screen handoff retains confirmed creation and retries only GET', async () => {
  const f = fixture(); let allow = false, attempts = 0;
  const creator = new ProjectCreator(f.client, () => { attempts++; return allow; });
  for (const [key, value] of Object.entries(draft)) creator.edit(key, value);
  try {
    await creator.create();
    assert.equal(creator.state.phase, 'created');
    assert.equal(creator.state.pending, null);
    assert.equal(creator.state.receipt.projectId, input.id);
    assert.match(creator.state.message, /화면 이동은 취소/);
    const confirmed = creator.state.receipt;
    await creator.create(); await creator.confirm();
    assert.equal(attempts, 1);
    await creator.open();
    assert.match(creator.state.message, /화면 이동은 취소/);
    allow = true; await creator.open();
    assert.equal(attempts, 3); assert.equal(creator.state.phase, 'created');
    assert.deepEqual(creator.state.receipt, confirmed);
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
    assert.equal(f.calls.filter(call => call.init.method === 'GET').length, 3);
  } finally { creator.destroy(); f.creator.destroy(); f.client.destroy(); }
});
test('creation transport and receipt agree with the actual core contract and retain current settings on handoff', async () => {
  assert.equal(await creationHash(input), await projectCreationHash(parseProjectCreation(input)));
  const f = fixture(); await f.creator.create();
  const write = f.calls[0]; assert.equal(write.url, '/v1/projects'); assert.equal(write.init.method, 'POST');
  assert.equal(write.init.credentials, 'omit'); assert.equal(write.init.cache, 'no-store'); assert.equal(write.init.referrerPolicy, 'no-referrer');
  assert.ok(!write.init.body.includes('not-a-credential')); assert.equal(f.opened[0].project.name, 'Current name');
  assert.equal(f.creator.state.phase, 'created'); assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
  await f.creator.create(); assert.equal(f.calls.length, 2); f.creator.destroy(); f.client.destroy();
});
test('field validation reports errors without writes and does not silently default empty limits', async () => {
  const f = fixture(); f.creator.edit('requestsPerMinute', ''); f.creator.edit('origins', 'https://example.invalid/path');
  await f.creator.create(); assert.ok(f.creator.state.errors.requestsPerMinute); assert.ok(f.creator.state.errors.origins); assert.equal(f.calls.length, 0);
  assert.ok(creationInput({ ...draft, timeZone: 'not-a-zone', id: 'BAD' }).errors.timeZone);
  f.creator.destroy();
});
test('lost creation response locks the immutable request until explicit confirmation, never auto-retries', async () => {
  const f = fixture(); let saved;
  f.config.post = async (_url, init) => { saved = await receipt(JSON.parse(init.body)); throw new TypeError('lost response'); };
  await f.creator.create(); assert.equal(f.creator.state.phase, 'uncertain');
  const pending = structuredClone(f.creator.state.pending); f.creator.edit('id', 'other'); await f.creator.create();
  assert.equal(f.creator.state.draft.id, input.id); assert.deepEqual(f.creator.state.pending, pending); assert.equal(f.calls.length, 1);
  f.config.post = async () => response(200, saved); await f.creator.confirm();
  assert.equal(f.opened.length, 1); assert.equal(f.calls[0].init.body, f.calls[1].init.body); f.creator.destroy();
});
test('known permission, quota and ID conflicts preserve the form and never infer creation authority from ownership', async () => {
  for (const [status, code, kind] of [[403, 'forbidden', 'forbidden'], [409, 'project_conflict', 'project_conflict'], [409, 'project_limit_reached', 'project_limit_reached']]) {
    const f = fixture(); f.config.post = async () => response(status, { error: { code, message: 'private server text' } });
    await f.creator.create(); assert.equal(f.creator.state.phase, 'ready'); assert.equal(f.creator.state.draft.id, input.id); assert.equal(f.opened.length, 0);
    assert.ok(!f.creator.state.message.includes('private server text')); if (kind === 'project_conflict') assert.ok(f.creator.state.errors.id);
    if (kind === 'forbidden') assert.match(f.creator.state.message, /별개로 생성 권한/); f.creator.destroy();
  }
});
test('a confirmed creation with a failed settings read retries only the GET and preserves its receipt', async () => {
  const f = fixture(); f.config.get = async () => { throw new TypeError('read unavailable'); };
  await f.creator.create(); const saved = f.creator.state.receipt; assert.equal(f.creator.state.phase, 'created');
  await f.creator.open(); assert.deepEqual(f.creator.state.receipt, saved); assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.equal(f.opened.length, 0); f.creator.destroy();
});
test('duplicate submits and disposal cannot open or mutate a project from a late response', async () => {
  const f = fixture(); let release;
  f.config.post = async () => new Promise(resolve => { release = resolve; });
  const first = f.creator.create(); while (!release) await new Promise(resolve => setImmediate(resolve));
  await f.creator.create(); assert.equal(f.calls.length, 1); f.creator.destroy();
  release(response(200, await receipt(input))); await first; assert.equal(f.opened.length, 0); assert.equal(f.calls.length, 1);
});
test('foreign hashes, malformed dates and response identities never report success', async () => {
  const f = fixture(); f.config.post = async () => response(200, { ...await receipt(input), creationHash: 'b'.repeat(64) });
  await f.creator.create(); assert.equal(f.creator.state.phase, 'uncertain'); assert.equal(f.opened.length, 0);
  for (const value of [{ ...await receipt(input), createdAt: '2026-02-30T00:00:00.000Z' }, { ...await receipt(input), projectId: 'Invalid' }])
    assert.throws(() => parseCreatedProject(value)); f.creator.destroy();
});
test('SDK connection code uses the published browser projection and omits admin authority and server-only events', () => {
  const registry = JSON.parse(readFileSync(new URL('../../../../api/examples/registry.json', import.meta.url), 'utf8'));
  registry.events.push({ name: 'server_only', label: 'server', source: 'server', properties: {} });
  const code = sdkSetup(registry, 'https://collector.example.invalid');
  const config = JSON.parse(code.split('  schema: ')[1].split(',\n});')[0]);
  assert.deepEqual(config, projectBrowserSchema(registry));
  assert.ok(code.includes(`/v1/projects/${registry.project.id}/batches`)); assert.ok(!code.includes('server_only'));
  assert.ok(!code.includes('Authorization')); assert.ok(!code.includes('not-a-credential')); assert.ok(!code.includes('allowLocalHttp'));
  assert.ok(sdkSetup(registry, 'http://127.0.0.1:5188').includes('allowLocalHttp: true'));
  for (const origin of ['', 'not a URL', 'https://collector.invalid/path', 'https://user@collector.invalid', 'https://collector.invalid?token=x', 'http://remote.invalid'])
    assert.throws(() => sdkSetup(registry, origin));
  assert.throws(() => sdkSetup({ ...registry, schemaStatus: 'retired' }, 'https://collector.invalid'));
});
