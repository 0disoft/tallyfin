import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { ObservationSummary } from '../observation-summary.ts';
import { readObservationSummary, readWranglerTailSummary } from '../summarize-observations.ts';
import { parseObservationReport } from '../../../apps/admin/src/api/observation-report.ts';
import { runCleanup } from '../../../apps/collector/src/cleanup.ts';

const id = (n: number) => `ff000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function row(n = 1, overrides: Record<string, unknown> = {}) {
  return { runId: id(n), code: 'retention_cleanup', attempted: 4, completed: 4, failed: 0, cursorAdvanced: true,
    execution: { elapsedMs: 3, stopReason: 'page_limit', interruptedProjects: 0, checkpointedProjects: 4, scheduleLagMs: 3500 }, ...overrides };
}
const summarize = (rows: unknown[]) => { const summary = new ObservationSummary(); rows.forEach(row => summary.addLine(JSON.stringify(row))); return summary.report(); };

test('mixed legacy, deferred, interrupted and checkpoint-error logs retain evidence without duplicate failures', async () => {
  const deferred = row(1, { attempted: 0, completed: 0, cursorAdvanced: false,
    execution: { elapsedMs: 20000, stopReason: 'time_budget', interruptedProjects: 0, checkpointedProjects: 0 } });
  const cancelled = row(2, { attempted: 1, completed: 0, cursorAdvanced: false,
    execution: { elapsedMs: 12, stopReason: 'cancelled', interruptedProjects: 1, checkpointedProjects: 0, scheduleLagMs: 7 } });
  const storage = row(3, { execution: { ...row().execution, stopReason: 'storage_error', checkpointedProjects: 0 } });
  const legacy = { runId: id(4), code: 'retention_cleanup', attempted: 3, completed: 2, failed: 1, cursorAdvanced: true };
  const rows = [deferred, cancelled, storage, legacy, cancelled, { runId: id(2), code: 'retention_cleanup_failed' }];
  const report = summarize(rows);
  assert.deepEqual(report.cleanup.execution, { reportedRuns: 3, interruptedProjects: 1, checkpointedProjects: 0, maxElapsedMs: 20000,
    scheduleLagSamples: 2, maxScheduleLagMs: 3500, failedRuns: 2, cursorNotAdvancedRuns: 2,
    stopReasons: [{ reason: 'time_budget', runs: 1 }, { reason: 'cancelled', runs: 1 }, { reason: 'storage_error', runs: 1 }] });
  assert.equal(report.cleanup.attemptedProjects, 8); assert.equal(report.cleanup.completedProjects, 6);
  assert.equal(report.cleanup.failedProjects, 1); assert.equal(report.input.duplicateLogLines, 1);
  assert.equal(report.diagnostics.findings.find(f => f.code === 'cleanup_failures')!.observedCount, 3);
  assert.deepEqual(parseObservationReport(report), report);
  const deferredOnly = summarize([deferred]);
  assert.equal(deferredOnly.diagnostics.findings.length, 0); assert.deepEqual(parseObservationReport(deferredOnly), deferredOnly);
  const text = rows.map(row => JSON.stringify(row)).join('\n');
  assert.deepEqual(await readObservationSummary(Readable.from([text])), report);
  const tail = JSON.stringify({ logs: rows.map(row => ({ message: [JSON.stringify(row)] })) });
  assert.deepEqual(await readWranglerTailSummary(Readable.from([tail])), report);
  assert.ok(!JSON.stringify(report).includes(id(1)));
});

test('all stop reasons are bounded, canonical and isolated from caller mutation', () => {
  const reasons = ['page_limit', 'time_budget', 'cycle_complete', 'empty_page', 'cursor_conflict', 'cancelled', 'storage_error'];
  for (const reason of reasons) {
    const failed = ['cursor_conflict', 'cancelled', 'storage_error'].includes(reason);
    const r = row(1, { cursorAdvanced: reason !== 'cursor_conflict', execution: { ...row().execution,
      stopReason: reason, checkpointedProjects: failed ? 0 : 4 } });
    const summary = new ObservationSummary(); summary.addLine(JSON.stringify(r));
    const reversed = { ...r, runId: r.runId.toUpperCase(), execution: Object.fromEntries(Object.entries(r.execution).reverse()) };
    summary.addLine(JSON.stringify(reversed));
    const result = summary.report(); assert.equal(result.input.duplicateLogLines, 1);
    assert.equal(result.cleanup.execution!.failedRuns, failed ? 1 : 0);
    assert.deepEqual(parseObservationReport(result), result);
    result.cleanup.execution!.stopReasons[0]!.runs = 999;
    assert.equal(summary.report().cleanup.execution!.stopReasons[0]!.runs, 1);
  }
});

test('actual cancellation report keeps in-flight uncertainty, the original reason and no private cause', async () => {
  const controller = new AbortController(), reason = { privateToken: 'never expose' }, rows: unknown[] = [];
  await assert.rejects(runCleanup({ nextCleanupPage: async () => ({ revision: 0, projects: [{ id: 'private-project', timeZone: 'UTC' }] }),
    cleanup: async () => { controller.abort(reason); throw reason; }, advanceCleanupCursor: async () => { throw Error('must not checkpoint'); },
  }, 0, { signal: controller.signal, clock: () => 5, onReport: report => rows.push({ runId: id(1), code: 'retention_cleanup', ...report }) }), cause => cause === reason);
  const result = summarize(rows);
  assert.equal(result.cleanup.execution!.interruptedProjects, 1); assert.equal(result.cleanup.failedProjects, 0);
  assert.deepEqual(parseObservationReport(result), result);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('unknown/private diagnostics, impossible progress and altered aggregate bounds fail closed', () => {
  const e = row().execution;
  for (const invalid of [null, { ...e, token: 'private' }, { ...e, elapsedMs: -1 }, { ...e, elapsedMs: 0.5 },
    { ...e, stopReason: '__proto__' }, { ...e, interruptedProjects: 1 }, { ...e, checkpointedProjects: 5 },
    { ...e, stopReason: 'cursor_conflict' }, { ...e, scheduleLagMs: null }, { ...e, scheduleLagMs: Infinity }])
    assert.throws(() => summarize([row(1, { execution: invalid })]));
  const report = summarize([row()]);
  for (const change of [
    (r: any) => { r.cleanup.execution.reportedRuns = 2; },
    (r: any) => { r.cleanup.execution.interruptedProjects = 1; },
    (r: any) => { r.cleanup.execution.checkpointedProjects = 5; },
    (r: any) => { r.cleanup.execution.checkpointedProjects = 0; },
    (r: any) => { r.cleanup.execution.stopReasons.push(r.cleanup.execution.stopReasons[0]); },
    (r: any) => { r.cleanup.execution.maxScheduleLagMs = null; },
    (r: any) => { r.cleanup.execution.cursorNotAdvancedRuns = 1; },
    (r: any) => { r.cleanup.execution.failedRuns = 1; },
    (r: any) => { r.cleanup.execution.token = 'private'; },
  ]) { const bad = structuredClone(report); change(bad); assert.throws(() => parseObservationReport(bad)); }
  const failedWithoutDiagnostics = summarize([row(1, { completed: 3, failed: 1 })]);
  delete (failedWithoutDiagnostics as any).diagnostics;
  failedWithoutDiagnostics.cleanup.execution!.failedRuns = 0;
  assert.throws(() => parseObservationReport(failedWithoutDiagnostics));
});
