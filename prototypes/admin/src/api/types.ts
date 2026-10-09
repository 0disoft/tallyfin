// Contract types for the Tallyfin administration reads.
// Source of truth: api/openapi.yaml (Administration tag). These mirror the
// wire shapes only; no sample or unregistered values are introduced here.

export type Project = { id: string; name: string; status: 'active' | 'paused'; timeZone: string };

export type ProjectPage = { data: Project[]; page: { limit: number; nextCursor: string | null } };

export type CollectionLimits = { requestsPerMinute: number; newReceiptsPerUtcDay: number };
export type ProjectSettings = { project: Project; allowedOrigins: string[]; limits: CollectionLimits; settingsHash: string; canEdit: boolean };
export type ProjectSettingsUpdate = { expectedSettingsHash: string; name?: string; status?: Project['status'];
  allowedOrigins?: string[]; limits?: Partial<CollectionLimits> };

export type PropertyDefinition =
  | { type: 'boolean'; required: boolean; purpose: string }
  | { type: 'enum'; required: boolean; purpose: string; values: string[] }
  | { type: 'integer'; required: boolean; purpose: string; minimum: number; maximum: number };

export type EventDefinition = {
  name: string;
  label: string;
  source: 'browser' | 'server';
  properties: Record<string, PropertyDefinition>;
};

export type WorkflowDefinition = {
  id: string;
  label: string;
  source: 'browser';
  startEvent: string;
  successEvent: string;
  failureEvent: string | null;
  dimensions: string[];
};

export type Registry = {
  project: Project;
  schemaVersion: number;
  schemaStatus: 'active' | 'retired';
  allowedOrigins: string[];
  limits: { requestsPerMinute: number; newReceiptsPerUtcDay: number };
  events: EventDefinition[];
  workflows: WorkflowDefinition[];
};

export type QueryMeta = {
  projectId: string;
  schemaVersion: number;
  source: 'browser';
  from: string;
  to: string;
  timeZone: string;
  generatedAt: string;
  latestReceivedAt: string | null;
  coverage: 'observed-only';
};

export type EventCount = { name: string; count: number };

export type SummaryResponse = { meta: QueryMeta; totalEvents: number; events: EventCount[] };

export type PropertyBucket = { value: boolean | number | string | null; count: number };

export type EventDay = { date: string; count: number; breakdown: PropertyBucket[] };

export type EventSeriesResponse = {
  meta: QueryMeta;
  eventName: string;
  groupBy: string | null;
  totalEvents: number;
  days: EventDay[];
};

export type WorkflowSummary = {
  startedAttempts: number;
  succeededAttempts: number;
  failedAttempts: number | null;
  pendingAttempts: number;
  completionRate: number | null;
};

export type WorkflowDay = WorkflowSummary & { date: string; provisional: boolean };

export type WorkflowResponse = {
  meta: QueryMeta;
  workflowId: string;
  cohortBasis: 'startedAt';
  summary: WorkflowSummary;
  days: WorkflowDay[];
};
