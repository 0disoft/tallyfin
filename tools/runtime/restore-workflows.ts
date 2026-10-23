import { D1Queries, type SqlDatabase } from '@tallyfin/storage-d1';
import { DRILL_TIME, type seedRestoreFixture } from './restore-fixture.ts';
type WorkflowResponse = Extract<Awaited<ReturnType<D1Queries['query']>>, { duration: unknown; summary: unknown }>;

/** Verify usable query results, not just that the new columns survived SQL export. */
export async function verifyRestoredWorkflows(db: SqlDatabase, fixture: Awaited<ReturnType<typeof seedRestoreFixture>>) {
  const response = await new D1Queries(db).query(fixture.principal, { projectId: fixture.browser.project.id, version: 1,
    kind: 'workflow', name: 'calculation', from: '2026-10-08', to: '2026-10-09' }, DRILL_TIME) as WorkflowResponse;
  const { summary, duration, failureReasons } = response;
  if (summary.startedAttempts !== 2 || summary.succeededAttempts !== 1 || summary.failedAttempts !== 1 || summary.pendingAttempts !== 0 ||
    duration?.measuredAttempts !== 2 || duration.unmeasuredAttempts !== 0 ||
    duration.buckets.some(bucket => bucket.succeededAttempts !== Number(bucket.range === '5s_to_30s') ||
      bucket.failedAttempts !== Number(bucket.range === '1s_to_5s')) ||
    failureReasons?.property !== 'error' || failureReasons.measuredFailures !== 1 || failureReasons.missingReasonFailures !== 0 ||
    failureReasons.unmeasuredFailures !== 0 || failureReasons.buckets.length !== 2 ||
    failureReasons.buckets.some(bucket => bucket.failedAttempts !== Number(bucket.value === 'range')) ||
    response.days[0]?.duration?.measuredAttempts !== 2 || response.days[1]?.duration?.measuredAttempts !== 0 ||
    response.days[0]?.failureReasons?.measuredFailures !== 1 || response.days[1]?.failureReasons?.measuredFailures !== 0)
    throw Error('restored_workflow_measurements_mismatch');
  return { summary, duration, failureReasons };
}
