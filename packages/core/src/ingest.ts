import { CollectionError } from './types.ts';
import type { PreparedBatch, PreparedServerBatch } from './types.ts';
import { COLLECTION_POLICY } from './policy.ts';
import { transitionWorkflow } from './workflow-transition.ts';
import { emptyDurationCounts, workflowDurationSlot } from './workflow-duration.ts';
import { planFunnelProgress } from './funnel.ts';
import type { FunnelDelta, FunnelRunState } from './funnel.ts';

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
  durationCounts?: number[];
}
export interface IngestSnapshot { receipts: Receipt[]; attempts: AttemptState[]; newReceiptsToday: number; funnelRuns?: FunnelRunState[] }
export interface IngestPlan {
  receipts: Receipt[]; attempts: AttemptState[]; events: EventDelta[]; workflows: WorkflowDelta[];
  funnelRuns: FunnelRunState[]; funnels: FunnelDelta[];
  accepted: number; duplicates: number;
}

export function planIngest(batch: PreparedBatch | PreparedServerBatch, snapshot: IngestSnapshot, dailyLimit: number): IngestPlan {
  const receipts = new Map(snapshot.receipts.filter(r => r.expires_at > batch.receivedAt).map(r => [r.event_id, r]));
  const attempts = new Map(snapshot.attempts.filter(a => a.expires_at > batch.receivedAt).map(a => [a.attempt_id, a]));
  const changed = new Map<string, AttemptState>();
  const runs = new Map((snapshot.funnelRuns ?? []).filter(run => run.expiresAt > batch.receivedAt).map(run => [run.runId, run]));
  const changedRuns = new Map<string, FunnelRunState>(); const funnelDeltas = new Map<string, FunnelDelta>();
  const eventDeltas = new Map<string, EventDelta>(); const workflowDeltas = new Map<string, WorkflowDelta>();
  const plan: IngestPlan = { receipts: [], attempts: [], events: [], workflows: [], funnelRuns: [], funnels: [], accepted: 0, duplicates: 0 };
  const addWorkflow = (state: AttemptState, start: number, success: number, failure: number) => {
    const key = JSON.stringify([state.cohort_date, state.workflow_id, state.dimension_key]);
    const delta = workflowDeltas.get(key) ?? { cohort_date: state.cohort_date, workflow_id: state.workflow_id,
      dimension_key: state.dimension_key, started_count: 0, succeeded_count: 0, failed_count: 0 };
    delta.started_count += start; delta.succeeded_count += success; delta.failed_count += failure;
    if (success || failure) {
      if (state.terminal_at === null || state.terminal_kind === null) throw new CollectionError('storage_unavailable', 503);
      const counts = delta.durationCounts ??= emptyDurationCounts();
      counts[workflowDurationSlot(state.terminal_at - state.started_at, state.terminal_kind)]! += success + failure;
    }
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
      payload_hash: prepared.payloadHash, received_at: batch.receivedAt, expires_at: batch.receivedAt + COLLECTION_POLICY.receiptTtlMs };
    plan.receipts.push(receipt); receipts.set(receipt.event_id, receipt);
    let duplicatePhase = false;
    if (prepared.funnel) {
      if (prepared.workflow) throw new CollectionError('invalid_event', 422);
      const id = prepared.funnel.event.funnel.runId;
      const progress = planFunnelProgress(prepared.funnel, runs.get(id) ?? null);
      runs.set(id, progress.state); changedRuns.set(id, progress.state); duplicatePhase = progress.duplicate;
      for (const delta of progress.deltas) {
        const key = JSON.stringify([delta.cohortDate, delta.funnelId, delta.dimensionKey, delta.stepIndex]);
        const total = funnelDeltas.get(key);
        funnelDeltas.set(key, total ? { ...total, reachedCount: total.reachedCount + delta.reachedCount } : delta);
      }
    }
    if (prepared.workflow) {
      const progress = transitionWorkflow({ ...prepared.workflow, schemaVersion: batch.schemaVersion }, prepared.occurredAt,
        attempts.get(prepared.workflow.attemptId));
      duplicatePhase = progress.duplicate;
      if (progress.delta) addWorkflow(progress.state, ...progress.delta);
      attempts.set(progress.state.attempt_id, progress.state); changed.set(progress.state.attempt_id, progress.state);
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
  plan.funnelRuns = [...changedRuns.values()]; plan.funnels = [...funnelDeltas.values()];
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
