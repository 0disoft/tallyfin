import { canonicalJson, closed, CollectionError, DAY, integer, localDate, planIngest, PROJECT_ID, REJECTION_REASONS, validateRegistry } from '@tallyfin/core';
import type { AttemptState, CollectionStore, PreparedBatch, Receipt, Registry, RejectionReason } from '@tallyfin/core';
import { bulk } from './sql.ts';
import type { ProjectRow, SchemaRow, SqlDatabase, SqlStatement } from './sql.ts';
export type { SqlDatabase, SqlStatement, SqlResult } from './sql.ts';
export { D1Queries } from './query.ts';
export { D1Maintenance } from './maintenance.ts';
export type { CleanupPage } from './maintenance.ts';

export class D1Store implements CollectionStore {
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
      !integer(row.requests_per_minute, 1, 600) || !integer(row.new_receipts_per_utc_day, 1, 1_000_000))
      throw new CollectionError('storage_unavailable', 503);
    return { id: row.id, name: row.name, status: row.status, timeZone: row.time_zone,
      allowedOrigins: origins,
      limits: { requestsPerMinute: row.requests_per_minute, newReceiptsPerUtcDay: row.new_receipts_per_utc_day } };
  }
  async admit(projectId: string, receivedAt: number, limit: number): Promise<boolean> {
    if (!PROJECT_ID.test(projectId) || !integer(receivedAt, 0, 8_640_000_000_000_000) || !integer(limit, 1, 600)) throw new CollectionError('invalid_request', 400);
    const minute = Math.floor(receivedAt / 60_000) * 60_000;
    const result = await this.db.batch<{ request_count: number }>([this.db.prepare(`
      INSERT INTO ingest_minute_usage (project_id, minute_start, request_count) VALUES (?, ?, 1)
      ON CONFLICT(project_id, minute_start) DO UPDATE SET request_count = min(request_count + 1, 601),
        rejections_json = CASE WHEN request_count >= ? THEN json_set(rejections_json, '$.minute_limit',
          json_object('count', min(coalesce(json_extract(rejections_json, '$.minute_limit.count'), 0) + 1, 9007199254740991),
            'lastRejectedAt', max(coalesce(json_extract(rejections_json, '$.minute_limit.lastRejectedAt'), 0), ?)))
          ELSE rejections_json END
      RETURNING request_count`).bind(projectId, minute, limit, receivedAt)]);
    const count = result[0]?.results[0]?.request_count;
    if (count === undefined) throw new CollectionError('storage_unavailable', 503);
    return count <= limit;
  }
  /** One update for an admitted, rejected request; no retry or request material retained. */
  async recordRejection(projectId: string, receivedAt: number, reason: RejectionReason): Promise<void> {
    if (!PROJECT_ID.test(projectId) || !integer(receivedAt, 0, 8_640_000_000_000_000) || !REJECTION_REASONS.includes(reason) || reason === 'minute_limit')
      throw new CollectionError('invalid_request', 400);
    const path = `$.${reason}`;
    const result = await this.db.batch([this.db.prepare(`UPDATE ingest_minute_usage SET rejections_json =
      json_set(rejections_json, ?, json_object('count', min(coalesce(json_extract(rejections_json, ?), 0) + 1, 600),
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
    if (!closed(definitions, ['events', 'workflows'])) throw Error('invalid registry');
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
    const utcDate = new Date(batch.receivedAt).toISOString().slice(0, 10);
    const eventIds = batch.events.map(e => e.event.eventId);
    const attemptIds = [...new Set(batch.events.flatMap(e => e.workflow ? [e.workflow.attemptId] : []))];
    const placeholders = (ids: string[]) => ids.map(() => '?').join(',') || 'NULL';
    // All mutations of ingest state increment projects.ingest_revision. Reads form one consistent snapshot.
    // A CHECK guard inside the write batch rolls back a raced snapshot; bounded retries re-read receipts.
    for (let retry = 0; retry < 3; retry++) {
      const read = await this.db.batch<ProjectRow | SchemaRow | Receipt | AttemptState | { new_receipts: number }>([
        this.db.prepare('SELECT * FROM projects WHERE id = ?').bind(batch.projectId),
        this.db.prepare('SELECT * FROM project_schemas WHERE project_id = ? AND version = ?').bind(batch.projectId, batch.schemaVersion),
        this.db.prepare(`SELECT * FROM event_receipts WHERE project_id = ? AND source = 'browser' AND event_id IN (${placeholders(eventIds)})`).bind(batch.projectId, ...eventIds),
        this.db.prepare(`SELECT * FROM workflow_attempts WHERE project_id = ? AND source = 'browser' AND attempt_id IN (${placeholders(attemptIds)})`).bind(batch.projectId, ...attemptIds),
        this.db.prepare('SELECT new_receipts FROM ingest_daily_usage WHERE project_id = ? AND utc_date = ?').bind(batch.projectId, utcDate),
      ]);
      const project = read[0]?.results[0] as ProjectRow | undefined;
      const schema = read[1]?.results[0] as SchemaRow | undefined;
      if (!project || project.status !== 'active') throw new CollectionError('project_unavailable', 403);
      if (!schema || schema.status !== 'active') throw new CollectionError('unknown_schema', 422);
      const currentRegistry = this.registry(project, schema);
      if (canonicalJson(currentRegistry) !== canonicalJson(registry)) throw new CollectionError('storage_unavailable', 503);
      const plan = planIngest(batch, { receipts: read[2]!.results as Receipt[], attempts: read[3]!.results as AttemptState[],
        newReceiptsToday: (read[4]?.results[0] as { new_receipts: number } | undefined)?.new_receipts ?? 0 }, project.new_receipts_per_utc_day);
      // Pure retransmission needs no write; it is linearized at the consistent read snapshot.
      if (!plan.receipts.length) return { accepted: plan.accepted, duplicates: plan.duplicates };
      const statements: SqlStatement[] = [this.db.prepare(`UPDATE projects SET
        ingest_revision = CASE WHEN ingest_revision = ? AND status = 'active' AND time_zone = ?
          AND allowed_origins_json = ? AND new_receipts_per_utc_day = ? AND requests_per_minute = ?
          AND EXISTS (SELECT 1 FROM project_schemas WHERE project_id = ? AND version = ? AND status = 'active' AND definitions_json = ?)
          THEN ingest_revision + 1 ELSE -1 END,
        latest_received_at = max(coalesce(latest_received_at, 0), ?) WHERE id = ?`).bind(project.ingest_revision, project.time_zone,
          project.allowed_origins_json, project.new_receipts_per_utc_day, project.requests_per_minute,
          batch.projectId, batch.schemaVersion, schema.definitions_json, batch.receivedAt, batch.projectId)];
      statements.push(...bulk(this.db, 'event_receipts', ['project_id', 'source', 'event_id', 'schema_version', 'payload_hash', 'received_at', 'expires_at'],
        plan.receipts.map(r => [batch.projectId, 'browser', r.event_id, r.schema_version, r.payload_hash, r.received_at, r.expires_at]),
        `ON CONFLICT(project_id, source, event_id) DO UPDATE SET schema_version=excluded.schema_version, payload_hash=excluded.payload_hash, received_at=excluded.received_at, expires_at=excluded.expires_at`));
      statements.push(...bulk(this.db, 'workflow_attempts', ['project_id', 'source', 'attempt_id', 'schema_version', 'workflow_id', 'started_at', 'cohort_date', 'dimension_key', 'start_seen', 'terminal_kind', 'terminal_at', 'expires_at'],
        plan.attempts.map(a => [batch.projectId, 'browser', a.attempt_id, a.schema_version, a.workflow_id, a.started_at, a.cohort_date, a.dimension_key, a.start_seen, a.terminal_kind, a.terminal_at, a.expires_at]),
        `ON CONFLICT(project_id, source, attempt_id) DO UPDATE SET schema_version=excluded.schema_version, workflow_id=excluded.workflow_id, started_at=excluded.started_at, cohort_date=excluded.cohort_date, dimension_key=excluded.dimension_key, start_seen=excluded.start_seen, terminal_kind=excluded.terminal_kind, terminal_at=excluded.terminal_at, expires_at=excluded.expires_at`));
      statements.push(this.db.prepare(`INSERT INTO ingest_daily_usage (project_id, utc_date, new_receipts, expires_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, utc_date) DO UPDATE SET new_receipts = new_receipts + excluded.new_receipts`).bind(
          batch.projectId, utcDate, plan.receipts.length, Date.parse(`${utcDate}T00:00:00Z`) + 4 * DAY));
      statements.push(...bulk(this.db, 'event_daily_counts', ['project_id', 'schema_version', 'source', 'event_date', 'event_name', 'dimension_key', 'count', 'updated_at'],
        plan.events.map(e => [batch.projectId, batch.schemaVersion, 'browser', e.event_date, e.event_name, e.dimension_key, e.count, batch.receivedAt]),
        `ON CONFLICT(project_id, schema_version, source, event_date, event_name, dimension_key) DO UPDATE SET count=count+excluded.count, updated_at=max(updated_at, excluded.updated_at)`));
      statements.push(...bulk(this.db, 'workflow_daily_counts', ['project_id', 'schema_version', 'source', 'cohort_date', 'workflow_id', 'dimension_key', 'started_count', 'succeeded_count', 'failed_count', 'updated_at'],
        plan.workflows.map(w => [batch.projectId, batch.schemaVersion, 'browser', w.cohort_date, w.workflow_id, w.dimension_key, 0, 0, 0, batch.receivedAt]),
        `ON CONFLICT(project_id, schema_version, source, cohort_date, workflow_id, dimension_key) DO NOTHING`));
      // SQLite validates the INSERT before resolving its conflict. A terminal-only delta
      // (0 starts, 1 success) is invalid as a new row, but valid when added to an existing cohort.
      // Create valid zero rows, then apply deltas within the same guarded atomic write batch.
      statements.push(...plan.workflows.map(w => this.db.prepare(`UPDATE workflow_daily_counts SET
        started_count=started_count+?, succeeded_count=succeeded_count+?, failed_count=failed_count+?,
        updated_at=max(updated_at, ?) WHERE project_id=? AND schema_version=? AND source='browser'
        AND cohort_date=? AND workflow_id=? AND dimension_key=?`).bind(w.started_count, w.succeeded_count,
          w.failed_count, batch.receivedAt, batch.projectId, batch.schemaVersion, w.cohort_date, w.workflow_id, w.dimension_key)));
      try {
        const committed = await this.db.batch(statements);
        if (committed[0]?.meta.changes !== 1 || committed.some(r => !r.success)) throw new CollectionError('storage_unavailable', 503);
        return { accepted: plan.accepted, duplicates: plan.duplicates };
      } catch (error) {
        // Only this named constraint denotes a stale revision. Every other database failure is fatal.
        const message = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : '';
        if (!message.includes('tallyfin_ingest_revision')) throw new CollectionError('storage_unavailable', 503);
      }
    }
    throw new CollectionError('storage_unavailable', 503);
  }
  async cleanup(projectId: string, timeZone: string, now: number, limit = 500): Promise<void> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error('invalid cleanup limit');
    const today = localDate(now, timeZone);
    const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10);
    const statements = ['event_receipts', 'workflow_attempts', 'ingest_daily_usage'].map(table => this.db.prepare(
      `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id = ? AND expires_at <= ? LIMIT ?)`
    ).bind(projectId, now, limit));
    statements.push(this.db.prepare(`DELETE FROM ingest_minute_usage WHERE rowid IN (SELECT rowid FROM ingest_minute_usage WHERE project_id = ?
      AND (minute_start < ? OR (rejections_json = '{}' AND minute_start < ?)) LIMIT ?)`).bind(projectId,
        Math.floor(now / DAY) * DAY - 6 * DAY, Math.floor(now / 60_000) * 60_000 - 120_000, limit));
    for (const [table, column] of [['event_daily_counts', 'event_date'], ['workflow_daily_counts', 'cohort_date']])
      statements.push(this.db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id = ? AND ${column} < ? LIMIT ?)`).bind(projectId, oldest, limit));
    const result = await this.db.batch(statements);
    if (result.length !== statements.length || result.some(row => !row.success)) throw new CollectionError('storage_unavailable', 503);
  }
}
