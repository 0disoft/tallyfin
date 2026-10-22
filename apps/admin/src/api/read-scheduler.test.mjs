import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from './client.ts';
import { createReadScheduler } from './read-scheduler.ts';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const page = { data: [], page: { limit: 25, nextCursor: null } };
const response = () => ({ ok: true, status: 200, json: async () => page });

test('one client bounds concurrent reads through body completion and preserves request order', async t => {
  const bodies = [], issued = []; let active = 0, maximum = 0;
  const client = new ApiClient({ fetchImpl: async url => {
    issued.push(url); const body = deferred(); bodies.push(body); active++; maximum = Math.max(maximum, active);
    return { ok: true, status: 200, json: async () => { await body.promise; active--; return page; } };
  } });
  t.after(() => client.destroy());
  const reads = Array.from({ length: 11 }, (_, i) => client.listProjects({ cursor: `project-${i}` }));
  await turn(); assert.equal(bodies.length, 4);
  for (let i = 0; i < 11; i++) { bodies[i].resolve(); await turn(); }
  assert.equal((await Promise.all(reads)).length, 11); assert.equal(maximum, 4); assert.equal(active, 0);
  assert.deepEqual(issued.map(url => new URL(url, 'https://example.invalid').searchParams.get('cursor')),
    Array.from({ length: 11 }, (_, i) => `project-${i}`));
});

test('queued cancellation never acquires credentials and canceled transport retains its real slot', async t => {
  const first = deferred(), controller = new AbortController(), queued = new AbortController();
  const reason = new Error('caller stopped'); let calls = 0, tokens = 0;
  const client = new ApiClient({ maxConcurrentReads: 1, getBearer: async () => { tokens++; return 'test-marker'; },
    fetchImpl: async () => { calls++; return calls === 1 ? first.promise : response(); } });
  t.after(() => client.destroy());
  const pending = client.listProjects({ signal: controller.signal }); await turn();
  const dropped = client.listProjects({ signal: queued.signal }), survivor = client.listProjects();
  queued.abort(reason); await assert.rejects(dropped, error => error === reason);
  controller.abort(reason); await assert.rejects(pending, error => error === reason);
  await turn(); assert.equal(calls, 1); assert.equal(tokens, 1);
  first.resolve(response()); await survivor;
  assert.equal(calls, 2); assert.equal(tokens, 2);
});

test('read queue is bounded and releases capacity on synchronous transport errors', async () => {
  const acquire = createReadScheduler(1, 1), signal = new AbortController().signal;
  const lease = await acquire(signal), waiting = acquire(signal);
  await assert.rejects(acquire(signal), /capacity/);
  assert.throws(() => lease.track(() => { throw Error('transport failure'); })); lease.close();
  const next = await waiting; next.close();
  const last = await acquire(signal); last.close();
});

test('writes bypass a saturated read queue without introducing mutation retries', async t => {
  let writes = 0;
  const client = new ApiClient({ maxConcurrentReads: 1, fetchImpl: async (_url, init) => {
    if (init.method === 'PATCH') { writes++; throw Error('write transport failure'); }
    return new Promise(() => {});
  } });
  t.after(() => client.destroy());
  const pending = client.listProjects(); const canceled = assert.rejects(pending);
  await turn();
  await assert.rejects(client.updateSettings('sample', { expectedSettingsHash: 'a'.repeat(64), name: 'Changed' }), { kind: 'network' });
  assert.equal(writes, 1); client.destroy(); await canceled;
});

test('deadline includes queue wait and destroy rejects queued reads without starting them', async () => {
  for (const stop of ['timeout', 'destroy']) {
    const held = deferred(); let calls = 0;
    const client = new ApiClient({ maxConcurrentReads: 1, requestTimeoutMs: 30,
      fetchImpl: () => { calls++; return held.promise; } });
    const expected = stop === 'timeout' ? { kind: 'timeout' } : { name: 'AbortError' };
    const first = assert.rejects(client.listProjects(), expected);
    const second = assert.rejects(client.listProjects(), expected);
    if (stop === 'destroy') client.destroy();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
    held.resolve(response()); client.destroy(); await turn();
  }
});

test('failed credentials release the read slot and invalid scheduler budgets are rejected', async () => {
  let tokens = 0, calls = 0;
  const client = new ApiClient({ maxConcurrentReads: 1,
    getBearer: async () => { if (++tokens === 1) throw Error('login failed'); return 'test-marker'; },
    fetchImpl: async () => { calls++; return response(); } });
  const failed = assert.rejects(client.listProjects(), { kind: 'unauthorized' });
  const next = client.listProjects();
  await failed; await next; assert.equal(calls, 1); client.destroy();
  for (const maximum of [0, 17, 1.5, NaN]) assert.throws(() => createReadScheduler(maximum), TypeError);
  for (const waiting of [-1, 1.5, NaN]) assert.throws(() => createReadScheduler(1, waiting), TypeError);
});
