import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ApiClient, ApiError } from './client.ts';
import { SettingsEditor } from './settings-editor.ts';
import { GrantList } from './grant-list.ts';

const page = { data: [], page: { limit: 25, nextCursor: null } };
const response = () => ({ ok: true, status: 200, json: async () => page });
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('native administration requests reject redirects without replaying reads or writes and can recover', async t => {
  const initial = { project: { id: 'sample', name: 'Sample', status: 'active', timeZone: 'Asia/Seoul' },
    allowedOrigins: [], limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, settingsHash: 'a'.repeat(64), canEdit: true };
  let redirect = true, targetRequests = 0;
  const methods = [];
  const server = createServer((request, reply) => {
    request.resume();
    if (request.url.startsWith('/redirect-target')) targetRequests++;
    else {
      methods.push(request.method);
      if (redirect) { reply.writeHead(307, { Location: '/redirect-target' }); reply.end(); return; }
    }
    reply.writeHead(200, { 'Content-Type': 'application/json' });
    reply.end(JSON.stringify(request.method === 'PATCH' ? initial : page));
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`, nativeFetch = globalThis.fetch;
  // Resolve browser-relative URLs while keeping the real native fetch transport.
  t.mock.method(globalThis, 'fetch', (url, init) => nativeFetch(new URL(url, origin), init));
  const client = new ApiClient(); t.after(() => client.destroy());
  for (const method of ['GET', 'PATCH']) await t.test(method, async () => {
    const callsBefore = methods.length;
    await assert.rejects(method === 'GET' ? client.listProjects()
      : client.updateSettings('sample', { expectedSettingsHash: initial.settingsHash, name: 'Changed' }),
    error => error instanceof ApiError && error.kind === 'network' && error.status === 0 && error.cause instanceof Error
      && !Object.keys(error).includes('cause') && !JSON.stringify(error).includes('unexpected redirect'));
    assert.deepEqual(methods.slice(callsBefore), [method]);
    assert.equal(targetRequests, 0);
  });
  redirect = false;
  assert.deepEqual(await client.listProjects(), page);
  assert.equal(targetRequests, 0);
});

test('one request deadline covers credentials, headers, success body and error body without automatic retries', { timeout: 1000 }, async t => {
  for (const phase of ['credential', 'headers', 'success-body', 'error-body']) {
    await t.test(phase, async t => {
      const stalled = deferred(); let calls = 0, signal;
      const client = new ApiClient({ requestTimeoutMs: 20,
        getBearer: () => phase === 'credential' ? stalled.promise : Promise.resolve('test-only-header'),
        fetchImpl: async (_url, init) => {
          calls++; signal = init.signal;
          if (phase === 'headers') return stalled.promise;
          return { ok: phase !== 'error-body', status: phase === 'error-body' ? 500 : 200, json: () => stalled.promise };
        },
      });
      t.after(() => client.destroy());
      await assert.rejects(client.listProjects(), error => error instanceof ApiError && error.kind === 'timeout' && error.status === 0);
      assert.equal(calls, phase === 'credential' ? 0 : 1);
      if (signal) assert.equal(signal.aborted, true);
      stalled.reject(Error('private provider or transport detail'));
      await turn(); // Late failures are handled and never become unhandled rejections.
      assert.equal(calls, phase === 'credential' ? 0 : 1);
    });
  }
});

test('elapsed deadlines remain enforced when synchronous work delays the timeout callback', async t => {
  for (const phase of ['credential', 'headers', 'success-body', 'error-body']) await t.test(phase, async t => {
    let now = 0, calls = 0, jsonCalls = 0, signal;
    t.mock.method(performance, 'now', () => now);
    const client = new ApiClient({ requestTimeoutMs: 100,
      getBearer: async () => { if (phase === 'credential') now = 100; return 'test-only-header'; },
      fetchImpl: async (_url, init) => {
        calls++; signal = init.signal;
        if (phase === 'headers') now = 100;
        return { ok: phase !== 'error-body', status: phase === 'error-body' ? 500 : 200,
          json: async () => { jsonCalls++; now = 100; return page; } };
      },
    });
    t.after(() => client.destroy());
    await assert.rejects(client.listProjects(), error => error instanceof ApiError && error.kind === 'timeout');
    assert.equal(calls, phase === 'credential' ? 0 : 1);
    assert.equal(jsonCalls, ['credential', 'headers'].includes(phase) ? 0 : 1);
    if (signal) assert.equal(signal.aborted, true);
  });
});

test('expired credential acquisition never dispatches a native settings mutation and permits explicit recovery', async t => {
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const initial = { project: { id: 'sample', name: 'Sample', status: 'active', timeZone: 'UTC' },
    allowedOrigins: [], limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, settingsHash: 'a'.repeat(64), canEdit: true };
  const committed = { ...initial, project: { ...initial.project, name: 'Changed' }, settingsHash: 'b'.repeat(64) };
  let stored = initial, block = false, dispatches = 0;
  const methods = [], server = createServer((request, reply) => {
    methods.push(request.method); request.resume();
    if (request.method === 'PATCH') stored = committed;
    reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify(stored));
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new ApiClient({ requestTimeoutMs: 5000,
    getBearer: async () => {
      if (block) elapsed += 5000;
      return 'test-only-header';
    },
    fetchImpl: (url, init) => { dispatches++; return fetch(new URL(url, origin), init); },
  });
  const editor = new SettingsEditor(client, 'sample');
  t.after(() => { editor.destroy(); client.destroy(); });
  await editor.load(); editor.edit('name', 'Changed'); block = true;
  await editor.save();
  assert.equal(dispatches, 1, 'expired credentials must not dispatch PATCH');
  assert.deepEqual(methods, ['GET']); assert.equal(stored, initial);
  assert.equal(editor.state.phase, 'review'); assert.equal(editor.state.draft.name, 'Changed');
  await editor.save(); assert.equal(dispatches, 1, 'uncertain writes must not repeat automatically');
  block = false; await editor.checkLatest(); editor.keepChanges(); await editor.save();
  assert.deepEqual(methods, ['GET', 'GET', 'PATCH']);
  assert.equal(editor.state.phase, 'ready'); assert.equal(editor.hasUnsavedChanges, false);
  assert.equal(stored, committed);
});

test('confirmed denial still clears analytics when headers or body synchronously consume the deadline', async t => {
  for (const status of [401, 403]) for (const phase of ['headers', 'body']) await t.test(`${status}-${phase}`, async t => {
    let now = 0, notifications = 0;
    t.mock.method(performance, 'now', () => now);
    const client = new ApiClient({ requestTimeoutMs: 100, onAnalyticsAccessDenied: () => notifications++,
      fetchImpl: async () => {
        if (phase === 'headers') now = 100;
        return { ok: false, status, json: async () => { now = 100; return {}; } };
      },
    });
    t.after(() => client.destroy());
    await assert.rejects(client.getSummary('sample', { schemaVersion: 1, from: '2026-10-01', to: '2026-10-02' }),
      error => error instanceof ApiError && error.status === status && error.kind === (status === 401 ? 'unauthorized' : 'forbidden'));
    assert.equal(notifications, 1);
  });
});

test('deadline does not restart between token acquisition and body reading; successful requests clear their timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const token = deferred(), body = deferred(); let signal, calls = 0;
  const client = new ApiClient({ requestTimeoutMs: 100, getBearer: () => token.promise,
    fetchImpl: async (_url, init) => { calls++; signal = init.signal; return { ok: true, status: 200, json: () => body.promise }; },
  });
  t.after(() => client.destroy());
  const pending = client.listProjects();
  const rejected = assert.rejects(pending, error => error.kind === 'timeout');
  await turn(); t.mock.timers.tick(60); token.resolve('test-only-header'); await turn();
  assert.equal(calls, 1); t.mock.timers.tick(40); await rejected;
  assert.equal(signal.aborted, true); body.resolve(page); await turn();

  let doneSignal;
  const done = new ApiClient({ fetchImpl: async (_url, init) => { doneSignal = init.signal; return response(); } });
  t.after(() => done.destroy());
  assert.deepEqual(await done.listProjects(), page);
  t.mock.timers.tick(120000);
  assert.equal(doneSignal.aborted, false);
});

test('caller abort and disconnect settle even if transport or body ignores abort, and late results stay discarded', { timeout: 1000 }, async () => {
  for (const phase of ['headers', 'success-body', 'error-body']) {
    for (const disconnect of [false, true]) {
      const stalled = deferred(); let signal;
      const client = new ApiClient({ fetchImpl: async (_url, init) => {
        signal = init.signal;
        return phase === 'headers' ? stalled.promise
          : { ok: phase !== 'error-body', status: phase === 'error-body' ? 403 : 200, json: () => stalled.promise };
      } });
      const controller = new AbortController();
      const pending = client.listProjects({ signal: controller.signal });
      const rejected = assert.rejects(pending, error => error.name === 'AbortError');
      await turn();
      if (disconnect) client.destroy(); else controller.abort();
      await rejected; assert.equal(signal.aborted, true);
      stalled.resolve(phase === 'headers' ? response() : page); await turn(); client.destroy();
    }
  }
});

test('a timed-out request does not cancel shared token refresh or launch a late fetch; a later request can recover', { timeout: 1000 }, async t => {
  const token = deferred(); let calls = 0;
  const client = new ApiClient({ requestTimeoutMs: 20, getBearer: () => token.promise,
    fetchImpl: async () => { calls++; return response(); },
  });
  t.after(() => client.destroy());
  await assert.rejects(client.listProjects(), error => error.kind === 'timeout');
  token.resolve('test-only-header'); await turn(); assert.equal(calls, 0);
  assert.deepEqual(await client.listProjects(), page); assert.equal(calls, 1);
});

test('invalid deadlines fail before transport and timeout leaves the settings loader in a recoverable error state', { timeout: 1000 }, async t => {
  for (const requestTimeoutMs of [0, 9, 120001, NaN, Infinity, 1.5])
    assert.throws(() => new ApiClient({ requestTimeoutMs }), error => error.kind === 'invalid_request');
  const client = new ApiClient({ requestTimeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  const editor = new SettingsEditor(client, 'sample');
  t.after(() => { editor.destroy(); client.destroy(); });
  await editor.load();
  assert.equal(editor.state.phase, 'error'); assert.equal(editor.state.blocked, false);
  assert.match(editor.state.message, /대기 시간이/);
});

test('observed 401/403 still clears privileged lists when the error body stalls', { timeout: 1000 }, async t => {
  for (const status of [401, 403]) {
    const client = new ApiClient({ requestTimeoutMs: 20,
      fetchImpl: async () => ({ ok: false, status, json: () => new Promise(() => {}) }),
    });
    const grants = new GrantList(client, 'sample');
    t.after(() => { grants.destroy(); client.destroy(); });
    await grants.refresh();
    assert.equal(grants.state.phase, 'error'); assert.equal(grants.state.denied, true);
    assert.equal(grants.state.data, null);
  }
});

test('a timed-out settings write preserves the draft, requires read-back, and never repeats the write', { timeout: 1000 }, async t => {
  const initial = { project: { id: 'sample', name: 'Sample', status: 'active', timeZone: 'Asia/Seoul' },
    allowedOrigins: [], limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, settingsHash: 'a'.repeat(64), canEdit: true };
  const committed = { ...initial, project: { ...initial.project, name: 'Changed' }, settingsHash: 'b'.repeat(64) };
  const late = deferred(); let writes = 0;
  const client = new ApiClient({ requestTimeoutMs: 20, fetchImpl: async (_url, init) => {
    if (init.method === 'PATCH') { writes++; return late.promise; }
    return { ok: true, status: 200, json: async () => writes ? committed : initial };
  } });
  const editor = new SettingsEditor(client, 'sample');
  t.after(() => { editor.destroy(); client.destroy(); });
  await editor.load(); editor.edit('name', 'Changed'); await editor.save();
  assert.equal(editor.state.phase, 'review'); assert.equal(editor.state.draft.name, 'Changed');
  assert.equal(editor.state.snapshot.settingsHash, initial.settingsHash);
  await editor.save(); assert.equal(writes, 1);
  late.resolve({ ok: true, status: 200, json: async () => committed }); await turn();
  assert.equal(editor.state.snapshot.settingsHash, initial.settingsHash);
  await editor.checkLatest(); editor.useServer();
  assert.equal(editor.state.phase, 'ready'); assert.equal(editor.state.snapshot.settingsHash, committed.settingsHash);
  await editor.save(); assert.equal(writes, 1);
});
