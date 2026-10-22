import { COLLECTION_POLICY, RETENTION_POLICY, ADMIN_CHANGE_RETENTION_DAYS, canonicalJson, closed, CollectionError, DAY, integer, localDate, planIngest, PROJECT_ID, REJECTION_REASONS, validGrantIdentity, validateRegistry } from '@tallyfin/core';
import type { PreparedBatch, PreparedServerBatch, Registry, RejectionReason, ServerCollectionStore, ServerPrincipal } from '@tallyfin/core';
import { ingestStatements } from './ingest-statements.ts';
import { readIngestSnapshot } from './ingest-snapshot.ts';
import { D1_POLICY } from './policy.ts';
import type { ProjectRow, SchemaRow, SqlDatabase } from './sql.ts';
import { readFunnelRun } from './funnels.ts';
export type { SqlDatabase, SqlStatement, SqlResult } from './sql.ts';
export { D1Queries } from './query.ts';
export { D1Maintenance } from './maintenance.ts';
export { adminChangeStatement } from './admin-changes.ts';
export type { CleanupPage } from './maintenance.ts';

export class D1Store implements ServerCollectionStore {
  readonly db: SqlDatabase;
  readonly allowLocalHttp: boolean;
  constructor(db: SqlDatabase, options: { allowLocalHttp?: boolean } = {}) {
    this.db = db; this.allowLocalHttp = options.allowLocalHttp ?? false;
  }
  async loadProject(projectId: string) {
    const results = await this.db.batch<ProjectRow>([this.db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId)]);
    const row = results[0]?.results[0];
    if (!row) return null;
    const origins: unknown = JSON.parse(row.allowed_origins_json);
    if (!Array.isArray(origins) || !origins.every((origin: unknown) => typeof origin === 'string') ||
      !integer(row.requests_per_minute, 1, COLLECTION_POLICY.maxRequestsPerMinute) || !integer(row.new_receipts_per_utc_day, 1, COLLECTION_POLICY.maxNewReceiptsPerUtcDay))
      throw new CollectionError('storage_unavailable', 503);
    return { id: row.id, name: row.name, status: row.status, timeZone: row.time_zone,
      allowedOrigins: origins,
      limits: { requestsPerMinute: row.requests_per_minute, newReceiptsPerUtcDay: row.new_receipts_per_utc_day } };
  }
  async admit(projectId: string, receivedAt: number, limit: number): Promise<boolean> {
    if (!PROJECT_ID.test(projectId) || !integer(receivedAt, 0, 8_640_000_000_000_000) || !integer(limit, 1, COLLECTION_POLICY.maxRequestsPerMinute)) throw new CollectionError('invalid_request', 400);
    const minute = Math.floor(receivedAt / 60_000) * 60_000;
    const result = await this.db.batch<{ request_count: number; current_limit: number }>([this.db.prepare(`
      INSERT INTO ingest_minute_usage (project_id, minute_start, request_count) VALUES (?, ?, 1)
      ON CONFLICT(project_id, minute_start) DO UPDATE SET request_count = min(request_count + 1, 601),
        rejections_json = CASE WHEN request_count >= (SELECT requests_per_minute FROM projects WHERE id = ?) THEN json_set(rejections_json, '$.minute_limit',
          json_object('count', min(coalesce(json_extract(rejections_json, '$.minute_limit.count'), 0) + 1, 9007199254740991),
            'lastRejectedAt', max(coalesce(json_extract(rejections_json, '$.minute_limit.lastRejectedAt'), 0), ?)))
          ELSE rejections_json END
      RETURNING request_count, (SELECT requests_per_minute FROM projects WHERE id = ?) AS current_limit`).bind(projectId, minute, projectId, receivedAt, projectId)]);
    const count = result[0]?.results[0]?.request_count;
    if (count === undefined) throw new CollectionError('storage_unavailable', 503);
    // The input limit remains a validated compatibility hint, never write authority.
    const currentLimit = result[0]?.results[0]?.current_limit;
    if (!integer(currentLimit, 1, COLLECTION_POLICY.maxRequestsPerMinute)) throw new CollectionError('storage_unavailable', 503);
    return count <= currentLimit;
  }
  /** One update for an admitted, rejected request; no retry or request material retained. */
  async recordRejection(projectId: string, receivedAt: number, reason: RejectionReason): Promise<void> {
    if (!PROJECT_ID.test(projectId) || !integer(receivedAt, 0, 8_640_000_000_000_000) || !REJECTION_REASONS.includes(reason) || reason === 'minute_limit')
      throw new CollectionError('invalid_request', 400);
    const path = `$.${reason}`;
    const result = await this.db.batch([this.db.prepare(`UPDATE ingest_minute_usage SET rejections_json =
      json_set(rejections_json, ?, json_object('count', min(coalesce(json_extract(rejections_json, ?), 0) + 1, ${COLLECTION_POLICY.maxRequestsPerMinute}),
        'lastRejectedAt', max(coalesce(json_extract(rejections_json, ?), 0), ?)))
      WHERE project_id = ? AND minute_start = ?`).bind(path, `${path}.count`, `${path}.lastRejectedAt`, receivedAt,
        projectId, Math.floor(receivedAt / 60_000) * 60_000)]);
    if (result.length !== 1 || !result[0]?.success || result[0].meta.changes !== 1) throw new CollectionError('storage_unavailable', 503);
  }
  async loadRegistry(projectId: string, version: number): Promise<Registry | null> {
    const snapshot = await this.configuration(projectId, version);
    if (!snapshot) return null;
    return this.registry(snapshot.project, snapshot.schema);
  }
  private registry(project: ProjectRow, schema: SchemaRow): Registry {
    const definitions: unknown = JSON.parse(schema.definitions_json);
    if (!closed(definitions, ['events', 'workflows'], ['funnels'])) throw Error('invalid registry');
    return validateRegistry({ ...definitions, project: { id: project.id, name: project.name, status: project.status, timeZone: project.time_zone },
      allowedOrigins: JSON.parse(project.allowed_origins_json), schemaVersion: schema.version, schemaStatus: schema.status,
      limits: { requestsPerMinute: project.requests_per_minute, newReceiptsPerUtcDay: project.new_receipts_per_utc_day } }, { allowLocalHttp: this.allowLocalHttp });
  }
  private async configuration(projectId: string, version: number) {
    const result = await this.db.batch<ProjectRow | SchemaRow>([
      this.db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId),
      this.db.prepare('SELECT * FROM project_schemas WHERE project_id = ? AND version = ?').bind(projectId, version),
    ]);
    const project = result[0]?.results[0] as ProjectRow | undefined;
    const schema = result[1]?.results[0] as SchemaRow | undefined;
    return project && schema ? { project, schema } : null;
  }
  async commit(batch: PreparedBatch, registry: Registry): Promise<{ accepted: number; duplicates: number }> {
    if (batch.source !== 'browser') throw new CollectionError('invalid_request', 400);
    return this.commitIngest(batch, registry);
  }
  async publisherAccess(projectId: string, principal: ServerPrincipal): Promise<void> {
    if (!PROJECT_ID.test(projectId) || !validGrantIdentity(principal?.issuer, principal?.subject)) throw new CollectionError('forbidden', 403);
    const read = await this.db.batch<{ authorized: number }>([this.db.prepare(
      'SELECT 1 AS authorized FROM project_publishers WHERE project_id = ? AND issuer = ? AND subject = ?')
      .bind(projectId, principal.issuer, principal.subject)]);
    if (read.length !== 1 || !read[0]?.success) throw new CollectionError('storage_unavailable', 503);
    if (read[0].results.length !== 1 || read[0].results[0]?.authorized !== 1) throw new CollectionError('forbidden', 403);
  }
  async commitServer(batch: PreparedServerBatch, registry: Registry, principal: ServerPrincipal): Promise<{ accepted: number; duplicates: number }> {
    if (batch.source !== 'server') throw new CollectionError('invalid_request', 400);
    if (!validGrantIdentity(principal?.issuer, principal?.subject)) throw new CollectionError('forbidden', 403);
    if (batch.events.some(event => event.workflow !== undefined || Object.hasOwn(event.event, 'attempt'))) throw new CollectionError('invalid_event', 422);
    return this.commitIngest(batch, registry, { issuer: principal.issuer, subject: principal.subject });
  }
  private async commitIngest(batch: PreparedBatch | PreparedServerBatch, registry: Registry, publisher?: ServerPrincipal): Promise<{ accepted: number; duplicates: number }> {
    // All mutations of ingest state increment projects.ingest_revision. Reads form one consistent snapshot.
    // A CHECK guard inside the write batch rolls back a raced snapshot; bounded retries re-read receipts.
    for (let retry = 0; retry < D1_POLICY.snapshotAttempts; retry++) {
      const snapshot = await readIngestSnapshot(this.db, batch, publisher);
      if (!snapshot.publisherAuthorized) throw new CollectionError('forbidden', 403);
      const { project, schema } = snapshot;
      if (!project || project.status !== 'active') throw new CollectionError('project_unavailable', 403);
      if (!schema || schema.status !== 'active') throw new CollectionError('unknown_schema', 422);
      const currentRegistry = this.registry(project, schema);
      if (canonicalJson(currentRegistry) !== canonicalJson(registry)) throw new CollectionError('storage_unavailable', 503);
      const plan = planIngest(batch, { receipts: snapshot.receipts, attempts: snapshot.attempts,
        funnelRuns: snapshot.runRows.map(readFunnelRun), newReceiptsToday: snapshot.newReceiptsToday }, project.new_receipts_per_utc_day);
      // Pure retransmission needs no write; it is linearized at the consistent read snapshot.
      if (!plan.receipts.length) return { accepted: plan.accepted, duplicates: plan.duplicates };
      const statements = ingestStatements(this.db, batch, project, schema, plan, publisher);
      try {
        const committed = await this.db.batch(statements);
        if (committed[0]?.meta.changes !== 1 || committed.some(r => !r.success)) throw new CollectionError('storage_unavailable', 503);
        return { accepted: plan.accepted, duplicates: plan.duplicates };
      } catch (error) {
        // Only this named constraint denotes a stale revision. Every other database failure is fatal.
        const message = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : '';
        if (!message.includes('tallyfin_ingest_revision')) throw new CollectionError('storage_unavailable', 503, { cause: error });
      }
    }
    throw new CollectionError('storage_unavailable', 503);
  }
  async cleanup(projectId: string, timeZone: string, now: number, limit: number = D1_POLICY.cleanupRows): Promise<void> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > D1_POLICY.maxCleanupRows) throw Error('invalid cleanup limit');
    const today = localDate(now, timeZone);
    const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - (RETENTION_POLICY.analyticsDays - 1) * DAY).toISOString().slice(0, 10);
    const statements = ['event_receipts', 'workflow_attempts', 'funnel_runs', 'ingest_daily_usage'].map(table => this.db.prepare(
      `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id = ? AND expires_at <= ? LIMIT ?)`
    ).bind(projectId, now, limit));
    statements.push(this.db.prepare(`DELETE FROM ingest_minute_usage WHERE rowid IN (SELECT rowid FROM ingest_minute_usage WHERE project_id = ?
      AND (minute_start < ? OR (rejections_json = '{}' AND minute_start < ?)) LIMIT ?)`).bind(projectId,
        Math.floor(now / DAY) * DAY - (RETENTION_POLICY.rejectionDays - 1) * DAY, Math.floor(now / 60_000) * 60_000 - RETENTION_POLICY.idleMinuteGraceMs, limit));
    for (const [table, column] of [['event_daily_counts', 'event_date'], ['workflow_daily_counts', 'cohort_date'], ['funnel_daily_counts', 'cohort_date']])
      statements.push(this.db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id = ? AND ${column} < ? LIMIT ?)`).bind(projectId, oldest, limit));
    statements.push(this.db.prepare(`DELETE FROM admin_changes WHERE id IN
      (SELECT id FROM admin_changes WHERE project_id = ? AND occurred_at < ? ORDER BY occurred_at, id LIMIT ?)`)
      .bind(projectId, now - ADMIN_CHANGE_RETENTION_DAYS * DAY, limit));
    const result = await this.db.batch(statements);
    if (result.length !== statements.length || result.some(row => !row.success)) throw new CollectionError('storage_unavailable', 503);
  }
}
