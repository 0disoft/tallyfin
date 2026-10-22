import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorkflowStats, workflowComparison } from './overview-workflow.ts';
import { parseOverview } from './overview-contract.ts';
const sample = (started = 30, succeeded = 15, failed = 5, provisional = false) => ({ startedAttempts: started,
  succeededAttempts: succeeded, failedAttempts: failed, pendingAttempts: started - succeeded - (failed ?? 0), provisional });
test('workflow comparison preserves 29/30/31 boundaries, zero denominators, pending and provisional periods', () => {
  for (const n of [29, 30, 31]) {
    const stats = { current: sample(n, 15, 0), previous: sample(30, 10, 0) };
    const rate = 15 / n * 100, previous = 10 / 30 * 100;
    assert.equal(workflowComparison(stats, rate, previous).delta, n < 30 ? null : rate - previous);
  }
  const current = sample(), previous = sample(30, 10);
  assert.equal(workflowComparison({ current: { ...current, provisional: true }, previous }, 50, 100 / 3).reason, '집계 중 · 비교 보류');
  assert.equal(workflowComparison({ current, previous: { ...previous, provisional: true } }, 50, 100 / 3).delta, null);
  assert.equal(workflowComparison({ current: sample(0, 0, null), previous }, null, 100 / 3).delta, null);
  assert.equal(workflowComparison(undefined, 100, 0).reason, '표본 정보 없음');
});
test('sample validation preserves frozen inputs and rejects rate/count contradictions, unsafe totals and private fields', () => {
  const current = Object.freeze(sample()), previous = Object.freeze(sample(0, 0, null)), stats = Object.freeze({ current, previous });
  assert.deepEqual(parseWorkflowStats(stats, 50, null), stats);
  for (const change of [v => v.current.pendingAttempts++, v => v.current.failedAttempts = 16, v => v.current.startedAttempts = Number.MAX_SAFE_INTEGER + 1,
    v => v.current.provisional = 1, v => v.current.private = 'secret', v => v.previous.succeededAttempts = 1]) {
    const value = structuredClone(stats); change(value); assert.throws(() => parseWorkflowStats(value, 50, null));
  }
  assert.throws(() => parseWorkflowStats(stats, 51, null));
});
test('overview permits absent sample metadata from older servers and validates new samples without mutating input', () => {
  const row = { projectId: 'sample', version: 1, latestReceivedAt: null, events: 0, previousEvents: 0,
    workflowLabel: 'Job', completion: 50, previousCompletion: null, workflowUnavailable: false,
    rejected: 0, rejectionUnavailable: false, error: false, accessDenied: false };
  const response = { source: 'browser', generatedAt: '2026-10-23T00:00:00.000Z', data: [row] };
  assert.equal(parseOverview(response).data[0].workflowStats, undefined);
  const stats = { current: sample(), previous: sample(0, 0, null) }, value = { ...response, data: [Object.freeze({ ...row, workflowStats: stats })] };
  assert.deepEqual(parseOverview(value).data[0].workflowStats, stats);
  assert.throws(() => parseOverview({ ...response, data: [{ ...row, workflowStats: null }] }));
  for (const change of [{ error: true }, { workflowUnavailable: true }, { workflowLabel: null }, { version: null }])
    assert.throws(() => parseOverview({ ...response, data: [{ ...row, ...change, workflowStats: stats }] }));
});
