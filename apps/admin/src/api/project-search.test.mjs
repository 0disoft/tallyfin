import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { ProjectSearch, PROJECT_SEARCH_DELAY_MS } from './project-search.ts';
import { firstProjectPage } from './project-page.ts';

const project = id => ({ id, name: id, status: 'active', timeZone: 'Asia/Seoul' });
const page = (ids, nextCursor = null) => ({ data: ids.map(project), page: { limit: 25, nextCursor } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('client passes normalized literal Unicode search and rejects oversized or control input before I/O', async () => {
  const urls = [];
  const client = new ApiClient({ fetchImpl: async url => { urls.push(url); return { ok: true, status: 200, json: async () => page([]) }; } });
  try {
    await client.listProjects({ q: ' 계산 Tool%_ ', cursor: 'alpha' });
    const url = new URL(urls[0], 'https://example.invalid');
    assert.equal(url.searchParams.get('q'), '계산 Tool%_'); assert.equal(url.searchParams.get('cursor'), 'alpha');
    await client.listProjects({ q: '가'.repeat(80) });
    await client.listProjects({ q: '  ' }); assert.ok(!urls[2].includes('q='));
    for (const q of ['가'.repeat(81), '\nabc', '\u0000', 12])
      await assert.rejects(client.listProjects({ q }), { kind: 'invalid_request' });
    assert.equal(urls.length, 3);
  } finally { client.destroy(); }
});

test('search debounces input and resets query, rows and cursor before issuing a new search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const search = new ProjectSearch({ listProjects: async options => { calls.push(options); return page(['alpha'], 'alpha'); } });
  try {
    search.search('a'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS - 1); assert.equal(calls.length, 0);
    search.search('alpha'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    assert.equal(calls.length, 1); assert.equal(calls[0].q, 'alpha'); assert.equal(search.state.nextCursor, 'alpha');
    search.search('new'); assert.equal(search.state.nextCursor, null); assert.deepEqual(search.state.items, []);
    t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    assert.equal(calls[1].cursor, null); assert.equal(calls[1].q, 'new');
    search.search('  '); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    assert.equal(search.state.phase, 'idle'); assert.equal(calls.length, 2);
  } finally { search.destroy(); }
});

test('search cancels superseded requests and late success or error cannot overwrite the current results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = deferred(), current = deferred(), calls = [];
  const search = new ProjectSearch({ listProjects: options => { calls.push(options); return calls.length === 1 ? old.promise : current.promise; } });
  try {
    search.search('old'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS);
    search.search('current'); assert.ok(calls[0].signal.aborted); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS);
    current.resolve(page(['current'])); await tick();
    old.resolve(page(['old'], 'old')); await tick();
    assert.deepEqual(search.state.items.map(p => p.id), ['current']); assert.equal(search.state.nextCursor, null);
    const late = deferred(); calls.length = 0;
    const second = new ProjectSearch({ listProjects: () => late.promise });
    second.search('late'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); second.search('');
    late.reject(Error('private transport detail')); await tick(); assert.equal(second.state.phase, 'idle'); second.destroy();
  } finally { search.destroy(); }
});

test('next search page preserves query, merges IDs, blocks concurrent reads and retries the same failed cursor', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(), calls = [];
  const search = new ProjectSearch({ listProjects: options => {
    calls.push(options);
    if (calls.length === 1) return Promise.resolve(page(['alpha'], 'alpha'));
    if (calls.length === 2) return pending.promise;
    return Promise.resolve(page(['alpha', 'zeta']));
  } });
  try {
    search.search('tool'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    const next = search.next(); await search.next(); assert.equal(calls.length, 2);
    pending.reject(Error('private transport detail')); await next;
    assert.equal(search.state.nextCursor, 'alpha'); assert.equal(search.state.more, false);
    assert.ok(!search.state.message.includes('private')); await search.retry();
    assert.equal(calls[2].cursor, 'alpha'); assert.equal(calls[2].q, 'tool');
    assert.deepEqual(search.state.items.map(p => p.id), ['alpha', 'zeta']);
  } finally { search.destroy(); }
});

test('search denial clears previous results, and destruction cancels requests, timers and notifications', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const kind of ['unauthorized', 'forbidden']) {
    let calls = 0;
    const search = new ProjectSearch({ listProjects: async () => { if (++calls === 1) return page(['alpha'], 'alpha'); throw new ApiError(kind, '접근할 수 없어요.'); } });
    search.search('tool'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick(); await search.next();
    assert.equal(search.state.phase, 'error'); assert.deepEqual(search.state.items, []); assert.equal(search.state.nextCursor, null);
    search.destroy();
  }
  const pending = deferred(), calls = [], states = [];
  const search = new ProjectSearch({ listProjects: options => { calls.push(options); return pending.promise; } });
  search.subscribe(state => states.push(state)); search.search('one'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS);
  search.search('two'); search.destroy(); const count = states.length;
  assert.ok(calls[0].signal.aborted); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS);
  pending.resolve(page(['one'])); await tick();
  assert.equal(calls.length, 1); assert.equal(states.length, count); assert.deepEqual(search.state.items, []);
});

test('initial search errors are visible, retryable and do not expose transport details', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fail = true;
  const search = new ProjectSearch({ listProjects: async () => { if (fail) throw Error('private'); return page([]); } });
  try {
    search.search('missing'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    assert.equal(search.state.phase, 'error'); assert.ok(!search.state.message.includes('private'));
    fail = false; await search.retry(); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    assert.equal(search.state.phase, 'ready'); assert.deepEqual(search.state.items, []);
  } finally { search.destroy(); }
});

test('a changed query cancels an in-flight next page and discards its cursor and late failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(), calls = [];
  const search = new ProjectSearch({ listProjects: options => {
    calls.push(options);
    return calls.length === 2 ? pending.promise : Promise.resolve(page([options.q], options.q === 'alpha' ? 'alpha' : null));
  } });
  try {
    search.search('alpha'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    const next = search.next(); search.search('zeta');
    assert.equal(calls[1].signal.aborted, true); assert.equal(search.state.more, false); assert.equal(search.state.nextCursor, null);
    t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick();
    pending.reject(new ApiError('forbidden', 'old denial')); await next;
    assert.deepEqual(search.state.items.map(p => p.id), ['zeta']); assert.equal(search.state.message, null);
    assert.equal(calls[2].cursor, null);
  } finally { search.destroy(); }
});

test('nonprogressing search cursors are recoverable errors rather than an endless next-page loop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const search = new ProjectSearch({ listProjects: async () => page(['alpha'], 'alpha') });
  try {
    search.search('alpha'); t.mock.timers.tick(PROJECT_SEARCH_DELAY_MS); await tick(); await search.next();
    assert.match(search.state.message, /진행하지/); assert.equal(search.state.more, false);
  } finally { search.destroy(); }
});

test('refresh retains an authorized off-page selection without changing the server cursor or mutating rows', async () => {
  const first = page(['alpha'], 'alpha'), selected = project('zeta'), calls = [];
  Object.freeze(first.data); Object.freeze(selected);
  const client = { listProjects: async () => first, getSettings: async (id, options) => { calls.push([id, options]); return { project: selected }; } };
  const controller = new AbortController();
  const result = await firstProjectPage(client, 'zeta', controller.signal);
  assert.deepEqual(result.data.map(p => p.id), ['alpha', 'zeta']); assert.equal(result.page.nextCursor, 'alpha');
  assert.equal(first.data.length, 1); assert.equal(calls[0][0], 'zeta'); assert.equal(calls[0][1].signal, controller.signal);
  await firstProjectPage(client, 'alpha', controller.signal); await firstProjectPage(client, null, controller.signal); assert.equal(calls.length, 1);
});

test('refresh drops a revoked selection but propagates ambiguous failures and exact cancellation', async () => {
  const controller = new AbortController();
  for (const kind of ['forbidden', 'not_found', 'unauthorized', 'storage_unavailable']) {
    const error = new ApiError(kind, 'failed');
    const client = { listProjects: async () => page(['alpha']), getSettings: async () => { throw error; } };
    if (['forbidden', 'not_found'].includes(kind)) assert.deepEqual((await firstProjectPage(client, 'zeta', controller.signal)).data.map(p => p.id), ['alpha']);
    else await assert.rejects(firstProjectPage(client, 'zeta', controller.signal), cause => cause === error);
  }
  const reason = Error('cancelled');
  await assert.rejects(firstProjectPage({ listProjects: async () => page([]), getSettings: async () => { controller.abort(reason); throw Error('other'); } }, 'zeta', controller.signal), cause => cause === reason);
});
