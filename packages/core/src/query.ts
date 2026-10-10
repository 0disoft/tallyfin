import { CollectionError } from './types.ts';
import type { Registry } from './types.ts';
import type { ProjectSettings, ProjectSettingsUpdate } from './settings.ts';
import type { PublishedSchema, SchemaPage, SchemaPublication } from './schema-publication.ts';
import type { CreatedProject } from './project-creation.ts';
import type { RejectionResponse } from './rejections.ts';
import { DAY, integer, localDate } from './value.ts';

/** Supplied only by a host verifier, never derived from an unverified request claim. */
export interface AdminPrincipal { issuer: string; subject: string }
export type Project = Registry['project'];
export interface ProjectGrant { issuer: string; subject: string; role: 'reader' | 'owner'; createdAt: string }
export interface ProjectGrantPage {
  projectId: string; data: ProjectGrant[]; page: { limit: number; nextCursor: string | null };
}
export type QueryKind = 'registry' | 'summary' | 'event' | 'workflow' | 'workflow-breakdown';
export interface AdminQuery {
  projectId: string; version: number; kind: QueryKind;
  from?: string; to?: string; name?: string; groupBy?: string;
}
export interface QueryMeta {
  projectId: string; schemaVersion: number; source: 'browser'; from: string; to: string;
  timeZone: string; generatedAt: string; latestReceivedAt: string | null; coverage: 'observed-only';
}
export interface AdminStore {
  grants(principal: AdminPrincipal, projectId: string, limit: number, cursor: string): Promise<ProjectGrantPage>;
  rejections(principal: AdminPrincipal, projectId: string, from: string, to: string, now: number): Promise<RejectionResponse>;
  creationAccess(principal: AdminPrincipal): Promise<void>;
  createProject(principal: AdminPrincipal, input: unknown, now: number): Promise<CreatedProject>;
  schemas(principal: AdminPrincipal, projectId: string, limit: number, beforeVersion: number | null): Promise<SchemaPage>;
  publishSchema(principal: AdminPrincipal, projectId: string, version: number, input: SchemaPublication, now: number): Promise<PublishedSchema>;
  settings(principal: AdminPrincipal, projectId: string): Promise<ProjectSettings>;
  updateSettings(principal: AdminPrincipal, projectId: string, update: ProjectSettingsUpdate): Promise<ProjectSettings>;
  list(principal: AdminPrincipal, limit: number, cursor: string): Promise<{ data: Project[]; page: { limit: number; nextCursor: string | null } }>;
  query(principal: AdminPrincipal, query: AdminQuery, now: number): Promise<unknown>;
}
export function dateMillis(value: string): number {
  const at = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value)
    throw new CollectionError('invalid_request', 400);
  return at;
}
export function queryDates(from: string, to: string, zone: string, now: number): string[] {
  const start = dateMillis(from), end = dateMillis(to), today = dateMillis(localDate(now, zone));
  if (start > end || end > today || start < today - 89 * DAY || (end - start) / DAY >= 31)
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
  let low = target - 2 * DAY, high = target + 3 * DAY;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dayAt(mid) <= date) low = mid + 1; else high = mid;
  }
  return low;
}
