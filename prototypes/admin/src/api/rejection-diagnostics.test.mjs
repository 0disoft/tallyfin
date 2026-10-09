import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApiClient } from './client.ts';
import { ContractError } from './validate.ts';
import { parseRejectionResponse, rejectionRange } from './rejection-diagnostics.ts';
const fixture = () => JSON.parse(readFileSync(new URL('../../../../api/examples/collection-rejections-response.json', import.meta.url)));

test('official response preserves positive, zero and null; UTC window crosses local midnight and year boundary', () => {
  const response = parseRejectionResponse(fixture());
  assert.equal(response.summary.rejectedRequests, 3);
  assert.equal(response.summary.reasons[1].count, 0); assert.equal(response.summary.reasons[1].lastRejectedAt, null);
  assert.deepEqual(rejectionRange(new Date('2026-10-10T15:01:00Z')), { from: '2026-10-04', to: '2026-10-10' });
  assert.deepEqual(rejectionRange(new Date('2027-01-01T00:00:00Z')), { from: '2026-12-26', to: '2027-01-01' });
  const empty = fixture();
  for (const row of [empty.summary, ...empty.days]) {
    row.rejectedRequests = 0; row.lastRejectedAt = null;
    row.reasons.forEach(bucket => { bucket.count = 0; bucket.lastRejectedAt = null; });
  }
  assert.equal(parseRejectionResponse(empty).summary.rejectedRequests, 0);
  empty.meta.generatedAt = '2026-10-10T02:01:00Z';
  assert.equal(parseRejectionResponse(empty).meta.generatedAt, '2026-10-10T02:01:00.000Z');
  empty.meta.generatedAt = '2026-10-10T02:01:00.1Z';
  assert.equal(parseRejectionResponse(empty).meta.generatedAt, '2026-10-10T02:01:00.100Z');
});

test('missing days, unknown/duplicate reasons, malformed times, unsafe counts and inconsistent totals fail closed', () => {
  const changes = [f => f.days.pop(), f => f.days.push(f.days[0]), f => f.days[0].date = '2026-10-09',
    f => f.meta.to = '2026-10-20', f => f.meta.from = '2026-02-30', f => f.meta.timeZone = 'Asia/Seoul',
    f => f.meta.coverage = 'complete', f => f.meta.generatedAt = 'invalid', f => f.summary.rejectedRequests = 4,
    f => f.summary.reasons[0].count = Number.MAX_SAFE_INTEGER + 1, f => f.summary.reasons[0].count = -1,
    f => f.summary.reasons[0].count = '2', f => f.summary.reasons[0].reason = 'other',
    f => f.summary.reasons[0].lastRejectedAt = null, f => f.summary.reasons[1].lastRejectedAt = f.summary.lastRejectedAt,
    f => f.summary.reasons[1] = f.summary.reasons[0], f => f.summary.reasons.pop(),
    f => f.days[0].reasons[0].lastRejectedAt = '2026-10-09T02:00:01.000Z',
    f => f.summary.lastRejectedAt = '2026-10-10T03:00:01.000Z', f => f.summary.ip = 'unexpected'];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => parseRejectionResponse(f), ContractError); }
  const mismatched = fixture();
  mismatched.summary.reasons[0].count = 1; mismatched.summary.reasons[2].count = 2;
  assert.throws(() => parseRejectionResponse(mismatched), ContractError);
});

test('all seven daily rows reconcile regardless of reason array order', () => {
  const f = fixture(); f.meta.from = '2026-10-04';
  const zero = structuredClone(f.days[0]); zero.rejectedRequests = 0; zero.lastRejectedAt = null;
  zero.reasons.forEach(row => { row.count = 0; row.lastRejectedAt = null; });
  f.days = [...Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(zero), date: `2026-10-0${i + 4}` })), f.days[0]];
  f.days[0].reasons.reverse();
  assert.equal(parseRejectionResponse(f).days.length, 7);
});

test('client sends only UTC dates and rejects cross-project, wrong-range and invalid-body responses', async () => {
  const options = { from: '2026-10-10', to: '2026-10-10' };
  const calls = [];
  const client = new ApiClient({ token: 'not-a-credential', fetchImpl: async (url, init) => {
    calls.push({ url, init }); return Response.json(fixture());
  } });
  assert.equal((await client.getCollectionRejections('example', options)).summary.rejectedRequests, 3);
  const url = new URL(calls[0].url, 'http://localhost');
  assert.equal(url.pathname, '/v1/projects/example/collection/rejections');
  assert.deepEqual([...url.searchParams], [['from', options.from], ['to', options.to]]);
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined);
  for (const change of [f => f.meta.projectId = 'other', f => f.meta.from = '2026-10-09', f => f.summary.reasons.pop()]) {
    const f = fixture(); change(f);
    const bad = new ApiClient({ token: 'not-a-credential', fetchImpl: async () => Response.json(f) });
    await assert.rejects(bad.getCollectionRejections('example', options), error => error.kind === 'contract');
    bad.destroy();
  }
  client.destroy();
});
