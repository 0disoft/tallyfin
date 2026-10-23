import { COLLECTION_POLICY, RETENTION_POLICY, QUERY_POLICY } from './policy.ts';
import { CollectionError } from './types.ts';
import type { Registry } from './types.ts';
import type { ProjectSettings, ProjectSettingsUpdate } from './settings.ts';
import type { PublishedSchema, SchemaPage, SchemaPublication } from './schema-publication.ts';
import type { CreatedProject } from './project-creation.ts';
import type { RejectionResponse } from './rejections.ts';
import type { GrantChange, GrantChangeResult } from './grants.ts';
import type { PublisherChange, PublisherChangeResult } from './publishers.ts';
import type { AdminChangePage } from './admin-changes.ts';
import { DAY, integer, localDate } from './value.ts';

/** Supplied only by a host verifier, never derived from an unverified request claim. */
export interface AdminPrincipal { issuer: string; subject: string }
export type Project = Registry['project'];
export interface ProjectGrant { issuer: string; subject: string; role: 'reader' | 'owner'; createdAt: string }
export interface ProjectGrantPage {
  projectId: string; grantRevision: number; data: ProjectGrant[]; page: { limit: number; nextCursor: string | null };
}
export interface ProjectPublisher { issuer: string; subject: string; createdAt: string; grantId: string }
export interface ProjectPublisherPage {
  projectId: string; data: ProjectPublisher[]; page: { limit: number; nextCursor: string | null };
}
export type QueryKind = 'registry' | 'summary' | 'event' | 'workflow' | 'workflow-breakdown' | 'funnel' | 'funnel-breakdown';
export interface AdminQuery {
  projectId: string; version: number; kind: QueryKind;
  from?: string; to?: string; name?: string; groupBy?: string; source?: 'browser' | 'server';
}
export interface QueryMeta {
  projectId: string; schemaVersion: number; source: 'browser' | 'server'; from: string; to: string;
  timeZone: string; generatedAt: string; latestReceivedAt: string | null; coverage: 'observed-only';
}
export interface AdminStore {
  schemaDraft?(principal: AdminPrincipal, projectId: string): Promise<import('./saved-schema-draft.ts').SchemaDraftSnapshot>;
  saveSchemaDraft?(principal: AdminPrincipal, projectId: string, input: import('./saved-schema-draft.ts').SaveSchemaDraft, now: number): Promise<import('./saved-schema-draft.ts').SchemaDraftSnapshot>;
  overview?(principal: AdminPrincipal, ids: readonly string[], source: 'browser' | 'server', now: number,
    options?: { signal?: AbortSignal }): Promise<import('./overview.ts').OverviewResponse>;
  changePublisher(principal: AdminPrincipal, projectId: string, change: PublisherChange, now: number): Promise<PublisherChangeResult>;
  publishers(principal: AdminPrincipal, projectId: string, limit: number, cursor: string): Promise<ProjectPublisherPage>;
  changes(principal: AdminPrincipal, projectId: string, limit: number, cursor: string, now: number): Promise<AdminChangePage>;
  changeGrant(principal: AdminPrincipal, projectId: string, change: GrantChange, now: number): Promise<GrantChangeResult>;
  grants(principal: AdminPrincipal, projectId: string, limit: number, cursor: string): Promise<ProjectGrantPage>;
  rejections(principal: AdminPrincipal, projectId: string, from: string, to: string, now: number): Promise<RejectionResponse>;
  creationAccess(principal: AdminPrincipal): Promise<void>;
  createProject(principal: AdminPrincipal, input: unknown, now: number): Promise<CreatedProject>;
  schemas(principal: AdminPrincipal, projectId: string, limit: number, beforeVersion: number | null): Promise<SchemaPage>;
  publishSchema(principal: AdminPrincipal, projectId: string, version: number, input: SchemaPublication, now: number): Promise<PublishedSchema>;
  settings(principal: AdminPrincipal, projectId: string): Promise<ProjectSettings>;
  updateSettings(principal: AdminPrincipal, projectId: string, update: ProjectSettingsUpdate, now?: number): Promise<ProjectSettings>;
  list(principal: AdminPrincipal, limit: number, cursor: string, q?: string): Promise<{ data: Project[]; page: { limit: number; nextCursor: string | null } }>;
  query(principal: AdminPrincipal, query: AdminQuery, now: number): Promise<unknown>;
}
/** Literal substring search; trim spaces without accepting controls or unbounded input. */
export function projectSearch(value: unknown = ''): string {
  if (typeof value !== 'string' || value.length > QUERY_POLICY.maxProjectSearchChars || /[\x00-\x1f\x7f]/.test(value))
    throw new CollectionError('invalid_request', 400);
  return value.trim();
}
export function dateMillis(value: string): number {
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value)
    throw new CollectionError('invalid_request', 400);
  return at;
}
export function queryDates(from: string, to: string, zone: string, now: number): string[] {
  const start = dateMillis(from), end = dateMillis(to), today = dateMillis(localDate(now, zone));
  if (start > end || end > today || start < today - (RETENTION_POLICY.analyticsDays - 1) * DAY || (end - start) / DAY >= QUERY_POLICY.maxDays)
    throw new CollectionError('invalid_request', 400);
  return Array.from({ length: (end - start) / DAY + 1 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
}
export function count(value: unknown): number {
  if (!integer(value, 0, Number.MAX_SAFE_INTEGER)) throw new CollectionError('storage_unavailable', 503);
  return value;
}
export const addCounts = (a: number, b: number) => count(a + count(b));
export function workflowCounts(started: number, succeeded: number, failed: number, hasFailure: boolean) {
  count(started); count(succeeded); count(failed);
  if (addCounts(succeeded, failed) > started || (!hasFailure && failed !== 0)) throw new CollectionError('storage_unavailable', 503);
  return { startedAttempts: started, succeededAttempts: succeeded, failedAttempts: hasFailure ? failed : null,
    pendingAttempts: started - succeeded - failed, completionRate: started ? succeeded / started * 100 : null };
}
/** UTC instant at the next project-local calendar day (including DST transitions). */
export function dateEnd(date: string, zone: string): number {
  const target = dateMillis(date);
  const formatter = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayAt = (at: number) => {
    const parts = formatter.formatToParts(at);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
  };
  let low = target - 2 * DAY, high = target + COLLECTION_POLICY.linkageTtlMs;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dayAt(mid) <= date) low = mid + 1; else high = mid;
  }
  return low;
}
