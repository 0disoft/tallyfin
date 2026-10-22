import { CollectionError } from './types.ts';
import type { PreparedEvent } from './types.ts';
import type { AttemptState } from './ingest.ts';
import { COLLECTION_POLICY } from './policy.ts';

type Delta = [started: number, succeeded: number, failed: number];
interface Transition { state: AttemptState; duplicate: boolean; delta: Delta | null }

/** Inputs are borrowed; every returned state belongs to the ingest plan. */
export function transitionWorkflow(workflow: NonNullable<PreparedEvent['workflow']> & { schemaVersion: number }, occurredAt: number,
  previous: Readonly<AttemptState> | undefined): Transition {
  const state: AttemptState = previous ? { ...previous } : {
    attempt_id: workflow.attemptId, schema_version: workflow.schemaVersion,
    workflow_id: workflow.id, started_at: workflow.startedAt, cohort_date: workflow.cohortDate,
    dimension_key: workflow.dimensionKey, start_seen: 0, terminal_kind: null, terminal_at: null,
    expires_at: workflow.startedAt + COLLECTION_POLICY.linkageTtlMs,
  };
  if (state.schema_version !== workflow.schemaVersion || state.workflow_id !== workflow.id ||
    state.started_at !== workflow.startedAt || state.dimension_key !== workflow.dimensionKey)
    throw new CollectionError('attempt_conflict', 409);
  if (workflow.phase === 'start') {
    if (state.start_seen === 1) return { state, duplicate: true, delta: null };
    return { state: { ...state, start_seen: 1 }, duplicate: false,
      delta: [1, Number(state.terminal_kind === 'success'), Number(state.terminal_kind === 'failure')] };
  }
  if (state.terminal_kind && state.terminal_kind !== workflow.phase) throw new CollectionError('attempt_conflict', 409);
  if (state.terminal_kind === workflow.phase) return { state, duplicate: true, delta: null };
  return { state: { ...state, terminal_kind: workflow.phase, terminal_at: occurredAt,
      ...(workflow.phase === 'failure' && workflow.failureReasonSlot !== undefined ? { failure_reason_slot: workflow.failureReasonSlot } : {}) }, duplicate: false,
    delta: state.start_seen ? [0, Number(workflow.phase === 'success'), Number(workflow.phase === 'failure')] : null };
}
