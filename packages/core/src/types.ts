export type PropertyValue = boolean | number | string;
export type Properties = Record<string, PropertyValue>;
type PropertyBase = { required: boolean; purpose: string };
export type PropertyDefinition = PropertyBase & (
  { type: 'boolean' } | { type: 'enum'; values: string[] } |
  { type: 'integer'; minimum: number; maximum: number }
);
export interface EventDefinition {
  name: string; label: string; source: 'browser' | 'server';
  properties: Record<string, PropertyDefinition>;
}
export interface WorkflowDefinition {
  id: string; label: string; source: 'browser'; startEvent: string;
  successEvent: string; failureEvent: string | null; dimensions: string[];
}
export interface FunnelDefinition {
  id: string; label: string; steps: { eventName: string; source: EventSource }[]; dimensions: string[];
}
export interface Registry {
  project: { id: string; name: string; status: 'active' | 'paused'; timeZone: string };
  schemaVersion: number; schemaStatus: 'active' | 'retired'; allowedOrigins: string[];
  limits: { requestsPerMinute: number; newReceiptsPerUtcDay: number };
  events: EventDefinition[]; workflows: WorkflowDefinition[]; funnels?: FunnelDefinition[];
}
export interface Attempt {
  workflowId: string; attemptId: string; startedAt: string;
}
export interface FunnelLink { funnelId: string; runId: string; startedAt: string }
export interface BrowserEvent {
  eventId: string; name: string; occurredAt: string; properties: Properties; attempt?: Attempt; funnel?: FunnelLink;
}
export interface BrowserBatch {
  schemaVersion: number; source: 'browser'; events: BrowserEvent[];
}
export type EventSource = 'browser' | 'server';
/** Server events carry no browser attempt identity or workflow state. */
export interface ServerEvent extends Omit<BrowserEvent, 'attempt'> { attempt?: never }
export interface ServerBatch {
  schemaVersion: number; source: 'server'; events: ServerEvent[];
}
export interface PreparedEvent {
  event: BrowserEvent; occurredAt: number; eventDate: string; dimensionKey: string;
  payloadHash: string;
  funnel?: import('./funnel.ts').PreparedFunnelObservation;
  workflow?: {
    id: string; phase: 'start' | 'success' | 'failure'; attemptId: string;
    startedAt: number; cohortDate: string; dimensionKey: string;
  };
}
export interface PreparedBatch {
  projectId: string; schemaVersion: number; source: 'browser'; receivedAt: number;
  events: PreparedEvent[];
}
export interface PreparedServerEvent extends Omit<PreparedEvent, 'event' | 'workflow'> {
  event: ServerEvent; workflow?: never;
}
export interface PreparedServerBatch {
  projectId: string; schemaVersion: number; source: 'server'; receivedAt: number;
  events: PreparedServerEvent[];
}
export type ErrorCode = 'invalid_request' | 'invalid_event' | 'unknown_schema' |
  'origin_denied' | 'project_unavailable' | 'event_conflict' | 'attempt_conflict' |
  'quota_exceeded' | 'unauthorized' | 'forbidden' | 'not_found' | 'storage_unavailable' | 'settings_conflict' | 'schema_conflict' | 'project_conflict' | 'project_limit_reached' | 'grant_conflict' | 'last_owner' | 'publisher_conflict';
export class CollectionError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, status: number, options?: ErrorOptions) {
    // Never include user input or database messages in public errors.
    super(code, options); this.name = 'CollectionError'; this.code = code; this.status = status;
  }
}
