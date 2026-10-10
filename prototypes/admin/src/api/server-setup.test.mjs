import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { ApiClient } from './client.ts';
import { SettingsEditor } from './settings-editor.ts';
import { creationInput } from './project-creation.ts';
import { parseProjectSettings } from './validate.ts';
import { sdkSetup } from './sdk-setup.ts';
import { loadCollectionDiagnostics } from './collection-diagnostics.ts';
import { parseProjectCreation } from '../../../../packages/core/src/project-creation.ts';
import { projectServerSchema } from '../../../../tools/server/schema.mjs';
import { projectBrowserSchema } from '../../../../tools/browser/schema.mjs';

const registry = () => JSON.parse(readFileSync(new URL('../../../../api/examples/job-registry.json', import.meta.url), 'utf8'));
const endpoint = 'https://collector.example.invalid';

test('server-only creation and settings accept no browser origins, and clearing origins sends an explicit empty array', async () => {
  const r = registry(), input = creationInput({ id: r.project.id, name: r.project.name, timeZone: r.project.timeZone,
    origins: '', requestsPerMinute: '120', newReceiptsPerUtcDay: '100000' });
  assert.deepEqual(input.errors, {}); assert.deepEqual(parseProjectCreation(input.input), input.input);
  const settings = { project: r.project, allowedOrigins: [], limits: r.limits, settingsHash: 'a'.repeat(64), canEdit: true };
  assert.deepEqual(parseProjectSettings(settings), settings);
  const writes = [];
  const client = new ApiClient({ fetchImpl: async (_url, init) => {
    if (init.method === 'PATCH') writes.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => init.method === 'PATCH' ? { ...settings, settingsHash: 'b'.repeat(64) }
      : { ...settings, allowedOrigins: ['https://app.example.invalid'] } };
  } });
  const editor = new SettingsEditor(client, r.project.id);
  await editor.load(); editor.edit('origins', ''); await editor.save();
  assert.deepEqual(writes, [{ expectedSettingsHash: settings.settingsHash, allowedOrigins: [] }]);
  assert.equal(editor.state.phase, 'ready'); assert.equal(editor.state.draft.origins, '');
  editor.destroy(); client.destroy();
});

test('server setup projects exactly reviewed server definitions and does not emit an unusable browser schema', () => {
  const r = registry(), code = sdkSetup(r, endpoint, 'server');
  const projected = JSON.parse(code.split('    schema: ')[1].split(',\n    getToken')[0]);
  assert.deepEqual(projected, projectServerSchema(r));
  assert.ok(code.includes('/v1/projects/jobs/server-batches')); assert.ok(code.includes("ServerOptions['getToken']"));
  assert.ok(!code.includes('workflows')); assert.ok(!code.includes('allowLocalHttp'));
  assert.ok(sdkSetup(r, 'http://localhost:5188', 'server').includes('allowLocalHttp: true'));
  assert.throws(() => sdkSetup(r, endpoint), /브라우저 이벤트/);
  assert.throws(() => projectBrowserSchema(r), /browser event/);
  assert.throws(() => sdkSetup(r, endpoint, 'all'));
  const browser = { ...r, events: r.events.map(event => ({ ...event, source: 'browser' })) };
  assert.throws(() => sdkSetup(browser, endpoint), /허용 출처/);
  assert.throws(() => sdkSetup(browser, endpoint, 'server'), /서버 이벤트/);
  for (const origin of ['https://collector.invalid/path', 'https://collector.invalid?token=x', 'https://user@collector.invalid', 'http://remote.invalid'])
    assert.throws(() => sdkSetup(r, origin, 'server'));
});

test('generated TypeScript server factory loads the real SDK and creates an event without requesting a token or sending it', async () => {
  const moduleUrl = new URL('../../../../packages/server/src/index.ts', import.meta.url).href;
  const { code } = await transform(sdkSetup(registry(), endpoint, 'server'), { loader: 'ts', format: 'esm', target: 'es2023' });
  const module = await import('data:text/javascript;base64,' + Buffer.from(code.replace('@tallyfin/server', moduleUrl)).toString('base64'));
  const client = module.connectServerAnalytics(() => assert.fail('setup must not request a credential'));
  const event = client.createEvent('job_finished', { outcome: 'success', retried: false });
  assert.equal(event.name, 'job_finished'); assert.deepEqual(event.properties, { outcome: 'success', retried: false });
  assert.match(event.eventId, /^[0-9a-f-]{36}$/);
});

test('diagnostics choose server for a server-only schema, allow explicit empty browser reads and reject wrong-source results', async () => {
  const r = registry(), now = new Date('2026-10-11T12:00:00Z'), calls = [];
  let wrong = false;
  const client = {
    getSettings: async () => ({ project: r.project, allowedOrigins: [], limits: r.limits, canEdit: true }),
    getSchema: async () => r,
    getCollectionRejections: async () => ({}),
    getSummary: async (_id, options) => {
      calls.push(options); const source = options.source ?? 'browser';
      return { meta: { projectId: r.project.id, schemaVersion: 1, source: wrong ? 'browser' : source, from: options.from, to: options.to,
        timeZone: 'UTC', generatedAt: now.toISOString(), latestReceivedAt: null, coverage: 'observed-only' },
        totalEvents: source === 'server' ? 3 : 0, events: source === 'server' ? [{ name: 'job_finished', count: 3 }] : [] };
    },
  };
  const signal = new AbortController().signal;
  const server = await loadCollectionDiagnostics(client, r.project.id, 1, signal, now);
  assert.equal(server.receipt.value.totalEvents, 3); assert.equal(calls[0].source, 'server');
  const browser = await loadCollectionDiagnostics(client, r.project.id, 1, signal, now, 'browser');
  assert.equal(browser.receipt.value.totalEvents, 0); assert.equal(calls[1].source, undefined);
  wrong = true;
  assert.equal((await loadCollectionDiagnostics(client, r.project.id, 1, signal, now, 'server')).receipt.error.kind, 'contract');
});
