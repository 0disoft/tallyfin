import type { ErrorCode } from '@tallyfin/core';
import type { RequestOperation } from '../../apps/collector/src/request-observation.ts';

interface ResponseEvidence { status: number; code: ErrorCode | 'ok'; observedResponses: number }
interface OperationEvidence { operation: RequestOperation; observedResponses: number; responses: readonly ResponseEvidence[] }
interface CleanupEvidence { observedRuns: number; reportedRuns: number; reportlessFailureRuns: number }
type FindingCode = 'storage_errors' | 'server_errors' | 'collection_quota_rejections' |
  'collection_configuration_rejections' | 'access_denials' | 'request_rejections' |
  'cleanup_failures' | 'cleanup_report_missing';
type Action = 'inspect_storage' | 'inspect_collector' | 'review_collection_limits' |
  'review_collection_configuration' | 'review_access_configuration' | 'review_request_contract' |
  'inspect_retention_cleanup' | 'inspect_cleanup_log_coverage';
interface Rule { code: FindingCode; severity: 'error' | 'review'; action: Action }
interface Finding extends Rule { operation: RequestOperation | 'retention_cleanup'; unit: 'responses' | 'runs'; observedCount: number }
const RULES = [
  { code: 'storage_errors', severity: 'error', action: 'inspect_storage' },
  { code: 'server_errors', severity: 'error', action: 'inspect_collector' },
  { code: 'collection_quota_rejections', severity: 'review', action: 'review_collection_limits' },
  { code: 'collection_configuration_rejections', severity: 'review', action: 'review_collection_configuration' },
  { code: 'access_denials', severity: 'review', action: 'review_access_configuration' },
  { code: 'request_rejections', severity: 'review', action: 'review_request_contract' },
  { code: 'cleanup_failures', severity: 'error', action: 'inspect_retention_cleanup' },
  { code: 'cleanup_report_missing', severity: 'review', action: 'inspect_cleanup_log_coverage' },
] as const satisfies readonly Rule[];

/** Mutually exclusive HTTP categories: counts cannot be inflated by overlapping rules. */
function category(operation: RequestOperation, response: ResponseEvidence): FindingCode | undefined {
  if (response.status >= 500) return response.code === 'storage_unavailable' ? 'storage_errors' : 'server_errors';
  if (response.status < 400 || response.status >= 500) return undefined;
  const collection = operation === 'browser_collection' || operation === 'server_collection';
  if (collection && response.status === 429 && response.code === 'quota_exceeded') return 'collection_quota_rejections';
  if (collection && ['origin_denied', 'project_unavailable', 'unknown_schema'].includes(response.code))
    return 'collection_configuration_rejections';
  if ((response.status === 401 || response.status === 403) && ['unauthorized', 'forbidden'].includes(response.code))
    return 'access_denials';
  return 'request_rejections';
}

/** Only called with validated, deduplicated app evidence; never turns missing evidence into health. */
export function diagnoseObservations(operations: readonly OperationEvidence[], cleanup: CleanupEvidence,
  failedCleanupRuns: number, ignoredOtherLogLines: number) {
  const findings: Finding[] = [];
  for (const operation of operations) {
    const counts = new Map<FindingCode, number>();
    for (const response of operation.responses) {
      const code = category(operation.operation, response);
      if (code) counts.set(code, (counts.get(code) ?? 0) + response.observedResponses);
    }
    for (const rule of RULES) {
      const observedCount = counts.get(rule.code);
      if (observedCount) findings.push({ ...rule, operation: operation.operation, unit: 'responses', observedCount });
    }
  }
  for (const rule of RULES) {
    const observedCount = rule.code === 'cleanup_failures' ? failedCleanupRuns :
      rule.code === 'cleanup_report_missing' ? cleanup.reportlessFailureRuns : 0;
    if (observedCount) findings.push({ ...rule, operation: 'retention_cleanup', unit: 'runs', observedCount });
  }
  return { schemaVersion: 'tallyfin.observation-diagnostics/v1', serviceHealth: 'unknown',
    coverage: { http: operations.some(operation => operation.observedResponses > 0) ? 'observed' : 'unobserved',
      cleanup: cleanup.observedRuns > 0 ? 'observed' : 'unobserved',
      cleanupDetails: cleanup.reportedRuns === 0 ? 'unobserved' :
        cleanup.reportlessFailureRuns > 0 ? 'partial_for_observed_runs' : 'complete_for_observed_runs',
      otherLogsIgnored: ignoredOtherLogLines > 0 }, findings };
}
