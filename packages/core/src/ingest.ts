import { CollectionError } from './types.ts';
import type { PreparedBatch, PreparedServerBatch } from './types.ts';
import { DAY } from './value.ts';

export interface Receipt { event_id: string; schema_version: number; payload_hash: string; received_at: number; expires_at: number }
export interface AttemptState {
  attempt_id: string; schema_version: number; workflow_id: string; started_at: number;
  cohort_date: string; dimension_key: string; start_seen: number;
  terminal_kind: 'success' | 'failure' | null; terminal_at: number | null; expires_at: number;
}
export interface EventDelta { event_date: string; event_name: string; dimension_key: string; count: number }
export interface WorkflowDelta {
  cohort_date: string; workflow_id: string; dimension_key: string;
  started_count: number; succeeded_count: number; failed_count: number;
}
export interface IngestSnapshot { receipts: Receipt[]; attempts: AttemptState[]; newReceiptsToday: number }
export interface IngestPlan {
  receipts: Receipt[]; attempts: AttemptState[]; events: EventDelta[]; workflows: WorkflowDelta[];
  accepted: number; duplicates: number;
}

export function planIngest(batch: PreparedBatch | PreparedServerBatch, snapshot: IngestSnapshot, dailyLimit: number): IngestPlan {
  const receipts = new Map(snapshot.receipts.filter(r => r.expires_at > batch.receivedAt).map(r => [r.event_id, r]));
  const attempts = new Map(snapshot.attempts.filter(a => a.expires_at > batch.receivedAt).map(a => [a.attempt_id, { ...a }]));
  const changed = new Map<string, AttemptState>();
  const eventDeltas = new Map<string, EventDelta>(); const workflowDeltas = new Map<string, WorkflowDelta>();
  const plan: IngestPlan = { receipts: [], attempts: [], events: [], workflows: [], accepted: 0, duplicates: 0 };
  const addWorkflow = (state: AttemptState, start: number, success: number, failure: number) => {
    const key = JSON.stringify([state.cohort_date, state.workflow_id, state.dimension_key]);
    const delta = workflowDeltas.get(key) ?? { cohort_date: state.cohort_date, workflow_id: state.workflow_id,
      dimension_key: state.dimension_key, started_count: 0, succeeded_count: 0, failed_count: 0 };
    delta.started_count += start; delta.succeeded_count += success; delta.failed_count += failure;
    workflowDeltas.set(key, delta);
  };
  for (const prepared of batch.events) {
    const previous = receipts.get(prepared.event.eventId);
    if (previous) {
      if (previous.payload_hash !== prepared.payloadHash || previous.schema_version !== batch.schemaVersion)
        throw new CollectionError('event_conflict', 409);
      plan.duplicates++; continue;
    }
    const receipt: Receipt = { event_id: prepared.event.eventId, schema_version: batch.schemaVersion,
      payload_hash: prepared.payloadHash, received_at: batch.receivedAt, expires_at: batch.receivedAt + 2 * DAY };
    plan.receipts.push(receipt); receipts.set(receipt.event_id, receipt);
    let duplicatePhase = false;
    if (prepared.workflow) {
      const workflow = prepared.workflow;
      const state = attempts.get(workflow.attemptId) ?? {
        attempt_id: workflow.attemptId, schema_version: batch.schemaVersion, workflow_id: workflow.id,
        started_at: workflow.startedAt, cohort_date: workflow.cohortDate, dimension_key: workflow.dimensionKey,
        start_seen: 0, terminal_kind: null, terminal_at: null, expires_at: workflow.startedAt + 3 * DAY,
      } satisfies AttemptState;
      if (state.schema_version !== batch.schemaVersion || state.workflow_id !== workflow.id || state.started_at !== workflow.startedAt ||
        state.dimension_key !== workflow.dimensionKey) throw new CollectionError('attempt_conflict', 409);
      if (workflow.phase === 'start') {
        duplicatePhase = state.start_seen === 1;
        if (!duplicatePhase) {
          state.start_seen = 1;
          addWorkflow(state, 1, Number(state.terminal_kind === 'success'), Number(state.terminal_kind === 'failure'));
        }
      } else {
        if (state.terminal_kind && state.terminal_kind !== workflow.phase) throw new CollectionError('attempt_conflict', 409);
        duplicatePhase = state.terminal_kind === workflow.phase;
        if (!duplicatePhase) {
          state.terminal_kind = workflow.phase; state.terminal_at = prepared.occurredAt;
          if (state.start_seen) addWorkflow(state, 0, Number(workflow.phase === 'success'), Number(workflow.phase === 'failure'));
        }
      }
      attempts.set(state.attempt_id, state); changed.set(state.attempt_id, state);
    }
    if (duplicatePhase) { plan.duplicates++; continue; }
    plan.accepted++;
    const key = JSON.stringify([prepared.eventDate, prepared.event.name, prepared.dimensionKey]);
    const delta = eventDeltas.get(key) ?? { event_date: prepared.eventDate, event_name: prepared.event.name, dimension_key: prepared.dimensionKey, count: 0 };
    delta.count++; eventDeltas.set(key, delta);
  }
  if (!Number.isSafeInteger(snapshot.newReceiptsToday) || snapshot.newReceiptsToday < 0 ||
    !Number.isSafeInteger(snapshot.newReceiptsToday + plan.receipts.length)) throw new CollectionError('storage_unavailable', 503);
  if (snapshot.newReceiptsToday + plan.receipts.length > dailyLimit) throw new CollectionError('quota_exceeded', 429);
  plan.attempts = [...changed.values()]; plan.events = [...eventDeltas.values()]; plan.workflows = [...workflowDeltas.values()];
  return plan;
}

export interface CollectionStore {
  loadProject(projectId: string): Promise<import('./types.ts').Registry['project'] & {
    allowedOrigins: string[]; limits: import('./types.ts').Registry['limits'];
  } | null>;
  admit(projectId: string, receivedAt: number, limit: number): Promise<boolean>;
  recordRejection(projectId: string, receivedAt: number, reason: Exclude<import('./rejections.ts').RejectionReason, 'minute_limit'>): Promise<void>;
  loadRegistry(projectId: string, version: number): Promise<import('./types.ts').Registry | null>;
  commit(batch: PreparedBatch, registry: import('./types.ts').Registry): Promise<{ accepted: number; duplicates: number }>;
}

/** Identity returned only after the host verifies a machine credential, including its API audience. */
export interface ServerPrincipal { issuer: string; subject: string }
export interface ServerCollectionStore extends CollectionStore {
  publisherAccess(projectId: string, principal: ServerPrincipal): Promise<void>;
  commitServer(batch: PreparedServerBatch, registry: import('./types.ts').Registry, principal: ServerPrincipal): Promise<{ accepted: number; duplicates: number }>;
}
