import { CollectionError } from './types.ts';
import { PROJECT_ID } from './value.ts';

export const OVERVIEW_PROJECT_LIMIT = 5;
export interface OverviewWorkflowSample {
  startedAttempts: number; succeededAttempts: number; failedAttempts: number | null; pendingAttempts: number; provisional: boolean;
}
export interface OverviewWorkflowStats { current: OverviewWorkflowSample; previous: OverviewWorkflowSample }
export interface OverviewPeriod { timeZone: string; from: string; to: string; previousFrom: string; previousTo: string }
export interface OverviewRow {
  /** Null version means no schema-based metrics; project diagnostics remain available. */
  projectId: string; version: number | null; latestReceivedAt: string | null;
  period: OverviewPeriod | null;
  events: number | null; previousEvents: number | null; workflowLabel: string | null;
  completion: number | null; previousCompletion: number | null; workflowUnavailable: boolean;
  workflowStats: OverviewWorkflowStats | null;
  rejected: number | null; rejectionUnavailable: boolean; error: boolean; accessDenied: boolean;
}
export interface OverviewResponse { source: 'browser' | 'server'; generatedAt: string; data: OverviewRow[] }
export function validateOverviewInput(ids: readonly string[], source: string): asserts source is 'browser' | 'server' {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > OVERVIEW_PROJECT_LIMIT ||
    ids.some(id => typeof id !== 'string' || !PROJECT_ID.test(id)) || new Set(ids).size !== ids.length ||
    !['browser', 'server'].includes(source)) throw new CollectionError('invalid_request', 400);
}
export function emptyOverviewRow(projectId: string): OverviewRow {
  return { projectId, version: null, latestReceivedAt: null, period: null, events: null, previousEvents: null, workflowLabel: null,
    completion: null, previousCompletion: null, workflowUnavailable: false, workflowStats: null, rejected: null, rejectionUnavailable: false, error: false, accessDenied: false };
}
