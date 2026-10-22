import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from './client.ts';
import { projectOverview } from './project-overview.ts';
import { parseOverview } from './overview-contract.ts';
const projects = Array.from({ length: 5 }, (_, n) => ({ id: 'service-' + n, name: 'Service ' + n, timeZone: 'Asia/Seoul', status: 'active' }));
const now = new Date('2026-10-23T00:00:00Z');
const empty = id => ({ projectId: id, version: null, latestReceivedAt: null, events: null, previousEvents: null, workflowLabel: null,
  completion: null, previousCompletion: null, workflowUnavailable: false, rejected: null, rejectionUnavailable: false, error: false, accessDenied: false });
const metrics = id => ({ ...empty(id), version: 1, events: 0, previousEvents: 0, rejected: 0 });
const payload = () => ({ source: 'browser', generatedAt: now.toISOString(), data: projects.map(p => metrics(p.id)) });
function fixture(body = payload()) {
  const calls = [], denials = [];
  const client = new ApiClient({ token: 'fixture', onAnalyticsAccessDenied: (id, error) => denials.push([id, error.kind]), fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { ok: true, status: 200, json: async () => body };
  } });
  return { client, calls, denials };
}
test('overview makes exactly one protected GET for five services, retaining order and zeros', async () => {
  const f = fixture(), signal = new AbortController().signal;
  try {
    const rows = await projectOverview(f.client, projects, 'browser', signal, now);
    assert.deepEqual(rows.map(row => row.project.id), projects.map(project => project.id));
    assert.ok(rows.every(row => row.events === 0 && row.rejected === 0 && row.completion === null));
    assert.equal(f.calls.length, 1);
    const { url, options } = f.calls[0], parsed = new URL(url, 'https://admin.invalid');
    assert.equal(parsed.pathname, '/v1/overview'); assert.equal(parsed.searchParams.get('projectIds'), projects.map(p => p.id).join(','));
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    assert.deepEqual(await projectOverview(f.client, [], 'browser', signal), []); assert.equal(f.calls.length, 1);
    await assert.rejects(projectOverview(f.client, [...projects, { ...projects[0], id: 'extra' }], 'browser', signal), RangeError);
    await assert.rejects(projectOverview(f.client, [projects[0], projects[0]], 'browser', signal), RangeError);
    assert.equal(f.calls.length, 1);
  } finally { f.client.destroy(); }
});
test('permission rows clear metrics, notify access revocation and preserve other services', async () => {
  const body = payload(); body.data[0] = { ...empty(projects[0].id), error: true, accessDenied: true }; body.data[1] = empty(projects[1].id);
  const f = fixture(body);
  try {
    const rows = await projectOverview(f.client, projects, 'browser', new AbortController().signal);
    assert.equal(rows[0].error, true); assert.equal(rows[0].events, null); assert.equal(rows[1].version, null); assert.equal(rows[2].events, 0);
    assert.deepEqual(f.denials, [[projects[0].id, 'forbidden']]);
  } finally { f.client.destroy(); }
});
test('overview rejects changed identities, counts, flags and unexpected fields', async () => {
  for (const mutate of [b => b.data.reverse(), b => b.source = 'server', b => b.data.pop(), b => b.data[0].events = -1,
    b => b.data[0].completion = 101, b => b.data[0].error = true, b => b.data[0].accessDenied = true,
    b => b.data[0].rejectionUnavailable = true, b => b.data[0].private = 'secret', b => b.data[0].latestReceivedAt = 'bad']) {
    const body = payload(); mutate(body); const f = fixture(body);
    try { await assert.rejects(f.client.getProjectOverview(projects.map(p => p.id), 'browser'), e => e.kind === 'contract'); }
    finally { f.client.destroy(); }
  }
  const body = payload(); body.data[0].workflowLabel = 'job'; body.data[0].workflowUnavailable = true;
  assert.equal(parseOverview(body).data[0].events, 0);
});
test('cancellation keeps the original reason and ignores a late response', async () => {
  const controller = new AbortController(), reason = { cancelled: true }; let calls = 0;
  const client = new ApiClient({ fetchImpl: async () => { calls++; controller.abort(reason); return { ok: true, status: 200, json: async () => payload() }; } });
  try {
    await assert.rejects(projectOverview(client, projects, 'browser', controller.signal), error => error === reason);
    assert.equal(calls, 1);
    await assert.rejects(projectOverview(client, projects, 'browser', controller.signal), error => error === reason);
    assert.equal(calls, 1);
  } finally { client.destroy(); }
});
test('a stalled 401 body revokes all requested analytics immediately on headers', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }), denials = [];
  const client = new ApiClient({ requestTimeoutMs: 100, onAnalyticsAccessDenied: id => denials.push(id),
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => { await wait; return {}; } }) });
  try {
    const read = client.getProjectOverview(projects.map(p => p.id), 'browser');
    await assert.rejects(read, e => e.kind === 'unauthorized');
    assert.deepEqual(denials, projects.map(p => p.id));
  } finally { release(); client.destroy(); }
});
