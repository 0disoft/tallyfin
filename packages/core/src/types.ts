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
export interface Registry {
  project: { id: string; name: string; status: 'active' | 'paused'; timeZone: string };
  schemaVersion: number; schemaStatus: 'active' | 'retired'; allowedOrigins: string[];
  limits: { requestsPerMinute: number; newReceiptsPerUtcDay: number };
  events: EventDefinition[]; workflows: WorkflowDefinition[];
}
export interface Attempt {
  workflowId: string; attemptId: string; startedAt: string;
}
export interface BrowserEvent {
  eventId: string; name: string; occurredAt: string; properties: Properties; attempt?: Attempt;
}
export interface BrowserBatch {
  schemaVersion: number; source: 'browser'; events: BrowserEvent[];
}
export interface PreparedEvent {
  event: BrowserEvent; occurredAt: number; eventDate: string; dimensionKey: string;
  payloadHash: string;
  workflow?: {
    id: string; phase: 'start' | 'success' | 'failure'; attemptId: string;
    startedAt: number; cohortDate: string; dimensionKey: string;
  };
}
export interface PreparedBatch {
  projectId: string; schemaVersion: number; source: 'browser'; receivedAt: number;
  events: PreparedEvent[];
}
export type ErrorCode = 'invalid_request' | 'invalid_event' | 'unknown_schema' |
  'origin_denied' | 'project_unavailable' | 'event_conflict' | 'attempt_conflict' |
  'quota_exceeded' | 'unauthorized' | 'forbidden' | 'not_found' | 'storage_unavailable';
export class CollectionError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, status: number) {
    // Never include user input or database messages in public errors.
    super(code); this.name = 'CollectionError'; this.code = code; this.status = status;
  }
}
