import { addCounts, closed, CollectionError, count, dateEnd, DAY, dateMillis, integer, NAME, PROJECT_ID, queryDates, validateRegistry, workflowCounts } from '@tallyfin/core';
import type { AdminPrincipal, AdminQuery, AdminStore, GrantChange, ProjectSettingsUpdate, QueryMeta, Registry, SchemaPublication } from '@tallyfin/core';
import { readDimensions } from './dimensions.ts';
import { workflowBreakdown, type WorkflowDimensionRow } from './workflow-breakdown.ts';
import { funnelSeries, type FunnelCountRow } from './funnel-query.ts';
import { listSchemas, publishSchema } from './schema.ts';
import { projectSettings, updateProjectSettings } from './settings.ts';
import { createProject, projectCreationAccess } from './creation.ts';
import { collectionRejections } from './rejections.ts';
import { listProjectGrants } from './grants.ts';
import { listProjectPublishers } from './publishers.ts';
import { changeProjectGrant } from './grant-change.ts';
import { listAdminChanges } from './admin-change-query.ts';
import type { ProjectRow, SchemaRow, SqlDatabase, SqlStatement } from './sql.ts';

const access = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = ? AND g.issuer = ? AND g.subject = ? AND g.role IN ('reader','owner'))";
interface ProjectState extends ProjectRow { latest_received_at: number | null }
interface EventRow { event_name: string; event_date: string; dimension_key: string; count: number }
interface WorkflowRow { cohort_date: string; started_count: number; succeeded_count: number; failed_count: number }

export class D1Queries implements AdminStore {
  readonly db: SqlDatabase;
  readonly options: { allowLocalHttp?: boolean };
  constructor(db: SqlDatabase, options: { allowLocalHttp?: boolean } = {}) { this.db = db; this.options = options; }
  publishers(principal: AdminPrincipal, id: string, limit: number, cursor: string) {
    return listProjectPublishers(this.db, principal, id, limit, cursor);
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
    if (!PROJECT_ID.test(input.projectId) || !integer(input.version, 1, 2147483647) || !['registry', 'summary', 'event', 'workflow', 'workflow-breakdown', 'funnel'].includes(input.kind) ||
      input.kind === 'funnel' && (input.groupBy !== undefined || !input.name || !NAME.test(input.name)))
      throw new CollectionError('invalid_request', 400);
    if (input.kind !== 'registry') {
      const start = dateMillis(input.from ?? ''), end = dateMillis(input.to ?? '');
      if (start > end || end - start >= 31 * DAY || (input.name !== undefined && !NAME.test(input.name))) throw new CollectionError('invalid_request', 400);
    }
    const grant = [input.projectId, principal.issuer, principal.subject];
    const statements: SqlStatement[] = [
      this.db.prepare(`SELECT p.* FROM projects p WHERE p.id = ? AND ${access}`).bind(input.projectId, ...grant),
      this.db.prepare(`SELECT * FROM project_schemas WHERE project_id = ? AND version = ? AND ${access}`).bind(input.projectId, input.version, ...grant),
    ];
    if (input.kind === 'summary') statements.push(this.db.prepare(`SELECT event_name, SUM(count) AS count FROM event_daily_counts
      WHERE project_id = ? AND schema_version = ? AND source = ? AND event_date BETWEEN ? AND ? AND ${access}
      GROUP BY event_name LIMIT 51`).bind(input.projectId, input.version, source, input.from!, input.to!, ...grant));
    else if (input.kind === 'event') statements.push(this.db.prepare(`SELECT event_date, dimension_key, count FROM event_daily_counts
      WHERE project_id = ? AND schema_version = ? AND source = ? AND event_name = ? AND event_date BETWEEN ? AND ? AND ${access}
      ORDER BY event_date, dimension_key LIMIT 7937`).bind(input.projectId, input.version, source, input.name!, input.from!, input.to!, ...grant));
    else if (input.kind === 'workflow-breakdown') statements.push(this.db.prepare(`SELECT cohort_date, dimension_key, started_count, succeeded_count, failed_count FROM workflow_daily_counts
      WHERE project_id = ? AND schema_version = ? AND source = 'browser' AND workflow_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
      ORDER BY cohort_date, dimension_key LIMIT 7937`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant));
    else if (input.kind === 'funnel') statements.push(this.db.prepare(`SELECT cohort_date, step_index, SUM(reached_count) AS reached_count FROM funnel_daily_counts
      WHERE project_id = ? AND schema_version = ? AND funnel_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
      GROUP BY cohort_date, step_index ORDER BY cohort_date, step_index LIMIT 311`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant));
    else if (input.kind === 'workflow') statements.push(this.db.prepare(`SELECT cohort_date, SUM(started_count) AS started_count,
      SUM(succeeded_count) AS succeeded_count, SUM(failed_count) AS failed_count FROM workflow_daily_counts
      WHERE project_id = ? AND schema_version = ? AND source = 'browser' AND workflow_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
      GROUP BY cohort_date LIMIT 32`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant));
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
    const rows = result[2]?.results ?? [];
    if (input.kind === 'funnel') {
      const { source: _source, ...funnelMeta } = meta;
      return funnelSeries(registry, input, funnelMeta, dates, rows as FunnelCountRow[], now);
    }
    if (input.kind === 'summary') {
      const counts = new Map((rows as EventRow[]).map(row => [row.event_name, count(row.count)]));
      const definitions = registry.events.filter(e => e.source === source);
      if (rows.length > 50 || [...counts.keys()].some(name => !definitions.some(e => e.name === name))) throw new CollectionError('storage_unavailable', 503);
      const events = definitions.map(e => ({ name: e.name, count: counts.get(e.name) ?? 0 }));
      return { meta, totalEvents: events.reduce((sum, e) => addCounts(sum, e.count), 0), events };
    }
    if (input.kind === 'event') return this.series(registry, input, meta, dates, rows as EventRow[]);
    if (input.kind === 'workflow-breakdown') return workflowBreakdown(registry, input, meta, dates, rows as WorkflowDimensionRow[], now);
    const definition = registry.workflows.find(w => w.id === input.name);
    if (!definition) throw new CollectionError('not_found', 404);
    if (rows.length > 31) throw new CollectionError('storage_unavailable', 503);
    const totals = { started: 0, succeeded: 0, failed: 0 };
    const byDate = new Map((rows as WorkflowRow[]).map(row => [row.cohort_date, row]));
    const days = dates.map(date => {
      const row = byDate.get(date);
      const started = count(row?.started_count ?? 0), succeeded = count(row?.succeeded_count ?? 0), failed = count(row?.failed_count ?? 0);
      totals.started = addCounts(totals.started, started); totals.succeeded = addCounts(totals.succeeded, succeeded); totals.failed = addCounts(totals.failed, failed);
      return { date, ...workflowCounts(started, succeeded, failed, definition.failureEvent !== null), provisional: now < dateEnd(date, p.time_zone) + 2 * DAY };
    });
    return { meta, workflowId: definition.id, cohortBasis: 'startedAt',
      summary: workflowCounts(totals.started, totals.succeeded, totals.failed, definition.failureEvent !== null), days };
  }
  private series(registry: Registry, input: AdminQuery, meta: QueryMeta, dates: string[], rows: EventRow[]) {
    const definition = registry.events.find(e => e.name === input.name && e.source === meta.source);
    if (!definition) throw new CollectionError('not_found', 404);
    if (input.groupBy && !Object.hasOwn(definition.properties, input.groupBy)) throw new CollectionError('invalid_request', 400);
    if (rows.length > 7936) throw new CollectionError('storage_unavailable', 503);
    const days = dates.map(date => ({ date, count: 0, breakdown: [] as { value: string | number | boolean | null; count: number }[] }));
    const byDate = new Map(days.map(d => [d.date, d]));
    for (const row of rows) {
      const day = byDate.get(row.event_date); if (!day) throw new CollectionError('storage_unavailable', 503);
      day.count = addCounts(day.count, row.count);
      if (input.groupBy) {
        const props = readDimensions(row.dimension_key, definition.properties);
        const value = Object.hasOwn(props, input.groupBy) ? props[input.groupBy]! : null;
        const existing = day.breakdown.find(b => b.value === value);
        if (existing) existing.count = addCounts(existing.count, row.count);
        else day.breakdown.push({ value, count: count(row.count) });
      }
    }
    for (const day of days) day.breakdown.sort((a, b) => JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
    return { meta, eventName: definition.name, groupBy: input.groupBy ?? null,
      totalEvents: days.reduce((sum, day) => addCounts(sum, day.count), 0), days };
  }
}
