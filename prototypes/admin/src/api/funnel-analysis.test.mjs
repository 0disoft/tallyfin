import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApiClient, ApiError } from './client.ts';
import { parseFunnelResponse, validateFunnelResponse } from './funnel-contract.ts';
import { FunnelReport } from './funnel-report.ts';
import { funnelCsv, funnelCsvFilename, FUNNEL_CSV_COLUMNS } from './funnel-csv.ts';
import { todayInZone } from './dates.ts';

const example = name => JSON.parse(readFileSync(new URL(`../../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
const fixture = () => example('funnel-response');
const registry = () => example('funnel-registry');
const range = { from: '2026-10-08', to: '2026-10-09' };
const ok = body => ({ ok: true, status: 200, json: async () => structuredClone(body) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('funnel wire parsing preserves cross-source counts and null edge ratios; definition/range matches the selected registry', () => {
  const data = parseFunnelResponse(fixture());
  assert.equal(data.summary.completionRate, 30); assert.equal(data.summary.steps[0].conversionRate, null);
  assert.equal(data.summary.steps.at(-1).notReachedNext, null); assert.equal(Object.hasOwn(data.meta, 'source'), false);
  assert.deepEqual(data.definition.steps.map(step => step.source), ['browser', 'browser', 'server', 'server']);
  validateFunnelResponse(data, registry(), range, 'conversion');
  for (const mutate of [r => r.project.id = 'other', r => r.project.timeZone = 'UTC', r => r.schemaVersion = 2,
    r => r.funnels = [], r => r.funnels[0].label = 'changed', r => r.funnels[0].steps[0].source = 'server',
    r => r.funnels[0].dimensions = []]) {
    const reg = registry(); mutate(reg); assert.throws(() => validateFunnelResponse(data, reg, range, 'conversion'));
  }
  assert.throws(() => validateFunnelResponse(data, registry(), { ...range, to: '2026-10-10' }, 'conversion'));
});

test('closed shapes and cohort/count/rate reconciliation reject malformed or mismatched API results', () => {
  for (const mutate of [r => r.meta.source = 'browser', r => r.runId = 'private', r => r.days[0].userId = 'private',
    r => r.definition.steps[0].unexpected = true, r => r.definition.steps[0].source = 'mixed', r => r.funnelId = 'other',
    r => r.meta.schemaVersion = 0, r => r.meta.timeZone = 'invalid', r => r.meta.generatedAt = '2026-02-30T00:00:00Z',
    r => r.meta.to = '2026-10-12', r => r.meta.from = '2026-07-01', r => r.meta.from = '2026-02-30',
    r => r.days = [], r => r.days.reverse(), r => r.days[0].date = '2026-10-09', r => r.days[0].provisional = true,
    r => r.days[1].provisional = false, r => r.summary.startedRuns++, r => r.summary.completedRuns++,
    r => r.summary.completionRate = 31, r => r.summary.steps[1].conversionRate = 1,
    r => r.summary.steps[1].reachRate = NaN, r => r.summary.steps[0].conversionRate = 100,
    r => r.summary.steps[0].notReachedNext = 0, r => r.summary.steps[0].reachedRuns = Number.MAX_SAFE_INTEGER + 1,
    r => r.summary.steps[0].reachedRuns = -1, r => r.summary.steps[0].reachedRuns = 0.1,
    r => r.summary.steps[0].stepIndex = 1, r => r.summary.steps[1].reachedRuns = 21,
    r => r.summary.steps.pop(), r => r.days[0].steps[0].reachedRuns--]) {
    const value = fixture(); mutate(value); assert.throws(() => parseFunnelResponse(value));
  }
});

test('zero denominators remain null and provisional boundaries follow project-local dates including DST', () => {
  const value = fixture();
  for (const row of [value.summary, ...value.days]) {
    row.startedRuns = row.completedRuns = 0; row.completionRate = null;
    row.steps.forEach((step, index) => Object.assign(step, { reachedRuns: 0, reachRate: null, conversionRate: null,
      notReachedNext: index + 1 < row.steps.length ? 0 : null }));
  }
  assert.equal(parseFunnelResponse(value).summary.completionRate, null);
  const broken = structuredClone(value); broken.summary.completionRate = 0; assert.throws(() => parseFunnelResponse(broken));
  const boundary = structuredClone(value); boundary.meta.generatedAt = '2026-10-11T15:00:00Z';
  boundary.days.forEach(day => day.provisional = false); assert.ok(parseFunnelResponse(boundary));
  const dst = structuredClone(value); dst.meta.timeZone = 'America/New_York'; dst.meta.from = '2026-03-08'; dst.meta.to = '2026-03-09';
  dst.meta.generatedAt = '2026-03-11T03:59:59.999Z';
  dst.days.forEach((day, i) => { day.date = `2026-03-0${8 + i}`; day.provisional = true; });
  assert.equal(todayInZone(dst.meta.timeZone, new Date(Date.parse(dst.meta.generatedAt) - 2 * 86400000)), '2026-03-08');
  assert.ok(parseFunnelResponse(dst)); dst.meta.generatedAt = '2026-03-11T04:00:00Z'; dst.days[0].provisional = false;
  assert.ok(parseFunnelResponse(dst));
});

test('client sends the authenticated same-origin funnel GET without source/groupBy and checks requested identity', async () => {
  const seen = [], client = new ApiClient({ token: 'not-a-credential', fetchImpl: async (url, init) => { seen.push({ url, init }); return ok(fixture()); } });
  const result = await client.getFunnelDaily('modufile', 'conversion', { schemaVersion: 1, ...range });
  assert.equal(result.summary.startedRuns, 20);
  const url = new URL(seen[0].url, 'https://example.invalid');
  assert.equal(url.pathname, '/v1/projects/modufile/funnels/conversion/daily');
  assert.deepEqual([...url.searchParams.keys()], ['schemaVersion', 'from', 'to']);
  assert.equal(seen[0].init.credentials, 'omit'); assert.equal(seen[0].init.cache, 'no-store');
  assert.equal(seen[0].init.referrerPolicy, 'no-referrer'); assert.equal(seen[0].init.headers.Authorization, 'Bearer not-a-credential');
  await assert.rejects(client.getFunnelDaily('other', 'conversion', { schemaVersion: 1, ...range }), error => error.kind === 'contract');
  client.destroy();
});

test('report clears data on retry/failure, preserves fixed HTTP error kind and refuses unregistered funnels', async () => {
  let failure = false;
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl: async () => failure
    ? { ok: false, status: 403, json: async () => ({ error: { code: 'forbidden', message: 'private storage detail' } }) } : ok(fixture()) });
  const states = [], report = new FunnelReport(client, state => states.push(state));
  await report.load(registry(), range, 'conversion', 'first'); assert.equal(report.state.phase, 'ready');
  failure = true; await report.load(registry(), range, 'conversion', 'first');
  assert.equal(states.at(-2).phase, 'loading'); assert.equal(states.at(-2).data, undefined);
  assert.equal(report.state.phase, 'error'); assert.equal(report.state.error.kind, 'forbidden');
  assert.equal(report.state.data, undefined); assert.ok(!report.state.error.message.includes('private storage detail'));
  failure = false; await report.load(registry(), range, 'conversion', 'first'); assert.equal(report.state.phase, 'ready');
  await report.load(registry(), range, 'unknown', 'first'); assert.equal(report.state.error.kind, 'invalid_request');
  report.dispose(); client.destroy();
});

test('report aborts and discards late results on selection/context changes and disposal', async () => {
  const requests = [], client = new ApiClient({ token: 'not-a-credential', fetchImpl: (url, init) => {
    const request = deferred(); requests.push({ ...request, init }); return request.promise;
  } });
  const states = [], report = new FunnelReport(client, state => states.push(state));
  const first = report.load(registry(), range, 'conversion', 'one');
  const second = report.load(registry(), range, 'conversion', 'two');
  assert.equal(requests[0].init.signal.aborted, true);
  requests[1].resolve(ok(fixture())); await second;
  requests[0].resolve(ok(fixture())); await first;
  assert.equal(report.state.context, 'two'); assert.equal(states.filter(state => state.phase === 'ready').length, 1);
  const third = report.load(registry(), range, 'conversion', 'three'); const length = states.length;
  report.dispose(); assert.equal(requests[2].init.signal.aborted, true);
  requests[2].resolve(ok(fixture())); await third;
  assert.equal(states.length, length); assert.equal(report.state.phase, 'idle'); client.destroy();
});

test('CSV includes all summary/daily stages, typed sources, unknown blanks, provisional flag and spreadsheet formula protection', () => {
  const data = fixture(); data.definition.label = '=unsafe, "label"';
  const csv = funnelCsv(data), rows = csv.slice(1).trimEnd().split('\r\n');
  assert.ok(csv.startsWith('\uFEFF')); assert.equal(rows.length, 1 + 4 * (data.days.length + 1));
  assert.equal(rows[0], FUNNEL_CSV_COLUMNS.map(name => `"${name}"`).join(','));
  assert.ok(csv.includes('"\'=unsafe, ""label"""')); assert.ok(csv.includes('"server"'));
  assert.ok(csv.includes('"summary","","0"')); assert.ok(csv.includes('"daily","2026-10-09"'));
  assert.ok(csv.includes('"30","true"')); assert.ok(csv.includes('"60","","20","6"'));
  assert.equal(funnelCsvFilename(data), 'tallyfin-modufile-v1-conversion-2026-10-08-2026-10-09-funnel.csv');
  data.summary.startedRuns++; assert.throws(() => funnelCsv(data));
});

test('clearing a selection cancels pending delivery without disposing the report for a later selection', async () => {
  const pending = deferred(); let signal, calls = 0;
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl: (_url, init) => {
    ++calls; signal = init.signal; return calls === 1 ? pending.promise : Promise.resolve(ok(fixture()));
  } });
  const states = [], report = new FunnelReport(client, state => states.push(state));
  const request = report.load(registry(), range, 'conversion', 'old'); report.cancel();
  assert.equal(signal.aborted, true); const count = states.length;
  pending.resolve(ok(fixture())); await request; assert.equal(states.length, count); assert.equal(report.state.phase, 'idle');
  await report.load(registry(), range, 'conversion', 'new'); assert.equal(report.state.phase, 'ready');
  assert.equal(report.state.context, 'new'); report.dispose(); client.destroy();
});
