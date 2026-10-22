import { closed, CollectionError, DAY, dateMillis, integer, NAME, PROJECT_ID, QUERY_POLICY, queryDates, validateRegistry } from '@tallyfin/core';
import type { AdminPrincipal, AdminQuery, AdminStore, GrantChange, PublisherChange, ProjectSettingsUpdate, QueryMeta, SchemaPublication } from '@tallyfin/core';
import { queryStatements } from './query-statements.ts';
import { queryResponse } from './query-response.ts';
import type { EventRow, WorkflowRow } from './query-response.ts';
import type { WorkflowDimensionRow } from './workflow-breakdown.ts';
import type { FunnelCountRow } from './funnel-query.ts';
import type { FunnelDimensionRow } from './funnel-breakdown.ts';
import { listSchemas, publishSchema } from './schema.ts';
import { projectOverview } from './overview.ts';
import { projectSettings, updateProjectSettings } from './settings.ts';
import { createProject, projectCreationAccess } from './creation.ts';
import { collectionRejections } from './rejections.ts';
import { listProjectGrants } from './grants.ts';
import { listProjectPublishers } from './publishers.ts';
import { changeProjectPublisher } from './publisher-change.ts';
import { changeProjectGrant } from './grant-change.ts';
import { listAdminChanges } from './admin-change-query.ts';
import type { ProjectRow, SchemaRow, SqlDatabase } from './sql.ts';

const access = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = ? AND g.issuer = ? AND g.subject = ? AND g.role IN ('reader','owner'))";
interface ProjectState extends ProjectRow { latest_received_at: number | null }

export class D1Queries implements AdminStore {
  readonly db: SqlDatabase;
  readonly options: { allowLocalHttp?: boolean };
  constructor(db: SqlDatabase, options: { allowLocalHttp?: boolean } = {}) { this.db = db; this.options = { ...options }; }
  overview(principal: AdminPrincipal, ids: readonly string[], source: 'browser' | 'server', now: number, options: { signal?: AbortSignal } = {}) {
    return projectOverview(this.db, principal, ids, source, now, { ...this.options, ...options });
  }
  publishers(principal: AdminPrincipal, id: string, limit: number, cursor: string) {
    return listProjectPublishers(this.db, principal, id, limit, cursor);
  }
  changePublisher(principal: AdminPrincipal, id: string, change: PublisherChange, now: number) {
    return changeProjectPublisher(this.db, principal, id, change, now);
  }
  changes(principal: AdminPrincipal, id: string, limit: number, cursor: string, now: number) {
    return listAdminChanges(this.db, principal, id, limit, cursor, now);
  }
  changeGrant(principal: AdminPrincipal, id: string, change: GrantChange, now: number) {
    return changeProjectGrant(this.db, principal, id, change, now);
  }
  grants(principal: AdminPrincipal, id: string, limit: number, cursor: string) {
    return listProjectGrants(this.db, principal, id, limit, cursor);
  }
  rejections(principal: AdminPrincipal, projectId: string, from: string, to: string, now: number) {
    return collectionRejections(this.db, principal, projectId, from, to, now);
  }
  creationAccess(principal: AdminPrincipal) { return projectCreationAccess(this.db, principal); }
  createProject(principal: AdminPrincipal, input: unknown, now: number) { return createProject(this.db, principal, input, now, this.options); }
  schemas(principal: AdminPrincipal, id: string, limit: number, beforeVersion: number | null) {
    return listSchemas(this.db, principal, id, limit, beforeVersion);
  }
  publishSchema(principal: AdminPrincipal, id: string, version: number, input: SchemaPublication, now: number) {
    return publishSchema(this.db, principal, id, version, input, now);
  }
  settings(principal: AdminPrincipal, id: string) { return projectSettings(this.db, principal, id, this.options); }
  updateSettings(principal: AdminPrincipal, id: string, update: ProjectSettingsUpdate, now = Date.now()) {
    return updateProjectSettings(this.db, principal, id, update, this.options, now);
  }
  async list(principal: AdminPrincipal, limit: number, cursor: string) {
    if (!integer(limit, 1, 100) || (cursor && !PROJECT_ID.test(cursor))) throw new CollectionError('invalid_request', 400);
    const result = await this.db.batch<ProjectState>([this.db.prepare(`SELECT p.* FROM projects p
      WHERE p.id > ? AND EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = p.id AND g.issuer = ? AND g.subject = ? AND g.role IN ('reader','owner'))
      ORDER BY p.id LIMIT ?`).bind(cursor, principal.issuer, principal.subject, limit + 1)]);
    if (result.length !== 1 || !result[0]?.success || !Array.isArray(result[0].results)) throw new CollectionError('storage_unavailable', 503);
    const rows = result[0].results;
    return { data: rows.slice(0, limit).map(p => ({ id: p.id, name: p.name, status: p.status, timeZone: p.time_zone })),
      page: { limit, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null } };
  }
  async query(principal: AdminPrincipal, input: AdminQuery, now: number) {
    const source = input.source ?? 'browser';
    if (input.source !== undefined && (!['browser', 'server'].includes(input.source) || !['summary', 'event'].includes(input.kind)))
      throw new CollectionError('invalid_request', 400);
    if (!PROJECT_ID.test(input.projectId) || !integer(input.version, 1, 2147483647) || !['registry', 'summary', 'event', 'workflow', 'workflow-breakdown', 'funnel', 'funnel-breakdown'].includes(input.kind) ||
      input.kind === 'funnel' && (input.groupBy !== undefined || !input.name || !NAME.test(input.name)) ||
      input.kind === 'funnel-breakdown' && (!input.name || !NAME.test(input.name) || !input.groupBy || !NAME.test(input.groupBy)))
      throw new CollectionError('invalid_request', 400);
    if (input.kind !== 'registry') {
      const start = dateMillis(input.from ?? ''), end = dateMillis(input.to ?? '');
      if (start > end || end - start >= QUERY_POLICY.maxDays * DAY || (input.name !== undefined && !NAME.test(input.name))) throw new CollectionError('invalid_request', 400);
    }
    const statements = queryStatements(this.db, principal, input, source);
    // Every read carries the grant predicate; all definitions, permission and counts share one batch snapshot.
    const result = await this.db.batch<ProjectState | SchemaRow | EventRow | WorkflowRow | WorkflowDimensionRow | FunnelCountRow>(statements);
    if (result.length !== statements.length || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
    const p = result[0]?.results[0] as ProjectState | undefined;
    if (!p) throw new CollectionError('forbidden', 403);
    const schema = result[1]?.results[0] as SchemaRow | undefined;
    if (!schema) throw new CollectionError('not_found', 404);
    const definitions: unknown = JSON.parse(schema.definitions_json);
    if (!closed(definitions, ['events', 'workflows'], ['funnels'])) throw new CollectionError('storage_unavailable', 503);
    const registry = validateRegistry({ ...definitions, project: { id: p.id, name: p.name, status: p.status, timeZone: p.time_zone },
      schemaVersion: schema.version, schemaStatus: schema.status, allowedOrigins: JSON.parse(p.allowed_origins_json),
      limits: { requestsPerMinute: p.requests_per_minute, newReceiptsPerUtcDay: p.new_receipts_per_utc_day } }, this.options);
    if (input.kind === 'registry') return registry;
    const dates = queryDates(input.from!, input.to!, p.time_zone, now);
    const meta: QueryMeta = { projectId: p.id, schemaVersion: schema.version, source, from: input.from!, to: input.to!,
      timeZone: p.time_zone, generatedAt: new Date(now).toISOString(),
      latestReceivedAt: p.latest_received_at === null ? null : new Date(p.latest_received_at).toISOString(), coverage: 'observed-only' };
    return queryResponse(registry, input, meta, dates, result[2]?.results ?? [], now);
  }
}
