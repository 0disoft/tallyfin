import { canonicalJson, schemaDefinitions, sha256 } from '@tallyfin/core';
import { adminChangeStatement, type SqlDatabase, type SqlStatement } from '@tallyfin/storage-d1';
import type { AdminChangeField, GrantRole } from '@tallyfin/core';
import type { ProjectRow, SchemaRow, SqlValue } from '../../packages/storage-d1/src/sql.ts';
import { operation, ProvisionError } from './input.ts';
import type { Operation } from './input.ts';

type Value = string | number | string[] | null;
interface Change { target: 'project' | 'schema' | 'grant'; field: string; before: Value; after: Value }
export interface Plan { operation: string; projectId: string; schemaVersion?: number; principalHash?: string; changes: Change[]; planHash: string }
interface Snapshot { project: ProjectRow | null; schema: SchemaRow | null; maxVersion: number | null; role: string | null; owners: number }
interface Pending { op: Operation; snapshot: Snapshot; changeCount: number }
const fail = (code: string, message: string): never => { throw new ProvisionError(code, message); };
const projectId = (op: Operation) => op.kind === 'register' ? op.registry.project.id : op.projectId;
const definitions = (op: Extract<Operation, { kind: 'register' }>) => canonicalJson(schemaDefinitions(op.registry));

/** Trusted offline DB operator tool. No HTTP endpoint or asserted-login authority. */
export class Provisioner {
  #db: SqlDatabase;
  #plans = new WeakMap<Plan, Pending>();
  #allowLocalHttp: boolean;
  constructor(db: SqlDatabase, allowLocalHttp = false) { this.#db = db; this.#allowLocalHttp = allowLocalHttp; }

  async #snapshot(op: Operation): Promise<Snapshot> {
    const id = projectId(op);
    const statements = [this.#db.prepare('SELECT * FROM projects WHERE id = ?').bind(id)];
    if (op.kind === 'register') {
      statements.push(this.#db.prepare('SELECT * FROM project_schemas WHERE project_id = ? AND version = ?').bind(id, op.registry.schemaVersion),
        this.#db.prepare('SELECT max(version) AS max_version FROM project_schemas WHERE project_id = ?').bind(id));
    } else {
      statements.push(this.#db.prepare('SELECT role FROM project_grants WHERE project_id = ? AND issuer = ? AND subject = ?').bind(id, op.issuer, op.subject),
        this.#db.prepare("SELECT count(*) AS owners FROM project_grants WHERE project_id = ? AND role = 'owner'").bind(id));
    }
    const rows = await this.#db.batch<ProjectRow | SchemaRow | { role: string } | { owners: number } | { max_version: number | null }>(statements);
    if (rows.length !== 3 || rows.some(row => !row.success)) throw Error();
    return { project: rows[0]!.results[0] as ProjectRow | undefined ?? null,
      schema: op.kind === 'register' ? rows[1]!.results[0] as SchemaRow | undefined ?? null : null,
      maxVersion: op.kind === 'register' ? (rows[2]!.results[0] as { max_version: number | null }).max_version : null,
      role: op.kind !== 'register' ? (rows[1]!.results[0] as { role: string } | undefined)?.role ?? null : null,
      owners: op.kind !== 'register' ? (rows[2]!.results[0] as { owners: number }).owners : 0 };
  }

  async plan(kind: string, input: unknown): Promise<Plan> {
    const op = operation(kind, input, this.#allowLocalHttp);
    let snapshot: Snapshot;
    try { snapshot = await this.#snapshot(op); }
    catch { return fail('database_unavailable', '로컬 DB 상태를 읽지 못했어요. init과 DB 경로를 확인해 주세요.'); }
    const changes: Change[] = [];
    const change = (target: Change['target'], field: string, before: Value, after: Value) => {
      if (canonicalJson(before) !== canonicalJson(after)) changes.push({ target, field, before, after });
    };
    const p = snapshot.project;
    if (op.kind === 'register') {
      const r = op.registry;
      if (p && p.time_zone !== r.project.timeZone) return fail('immutable_timezone', '기존 프로젝트 시간대는 바꿀 수 없어요. 새 프로젝트로 등록해 주세요.');
      if (snapshot.schema && canonicalJson(JSON.parse(snapshot.schema.definitions_json)) !== definitions(op))
        return fail('immutable_schema', '발행한 스키마 내용은 바꿀 수 없어요. 더 높은 버전을 등록해 주세요.');
      if (!snapshot.schema && snapshot.maxVersion !== null && r.schemaVersion <= snapshot.maxVersion)
        return fail('invalid_version', '새 스키마는 기존 최고 버전보다 높은 번호로 등록해 주세요.');
      change('project', 'name', p?.name ?? null, r.project.name);
      change('project', 'status', p?.status ?? null, r.project.status);
      change('project', 'timeZone', p?.time_zone ?? null, r.project.timeZone);
      change('project', 'allowedOrigins', p ? JSON.parse(p.allowed_origins_json).sort() : null, r.allowedOrigins);
      change('project', 'requestsPerMinute', p?.requests_per_minute ?? null, r.limits.requestsPerMinute);
      change('project', 'newReceiptsPerUtcDay', p?.new_receipts_per_utc_day ?? null, r.limits.newReceiptsPerUtcDay);
      change('schema', 'definitionHash', snapshot.schema ? await sha256(canonicalJson(JSON.parse(snapshot.schema.definitions_json))) : null, await sha256(definitions(op)));
      change('schema', 'status', snapshot.schema?.status ?? null, r.schemaStatus);
    } else {
      if (!p) return fail('project_not_found', '먼저 프로젝트를 등록해 주세요.');
      if (snapshot.role === 'owner' && op.role !== 'owner' && snapshot.owners <= 1)
        return fail('last_owner', '마지막 owner를 제거하거나 낮출 수 없어요. 다른 owner를 먼저 등록해 주세요.');
      change('grant', 'role', snapshot.role, op.role);
    }
    const plan: Plan = structuredClone({ operation: op.kind, projectId: projectId(op), changes,
      ...(op.kind === 'register' ? { schemaVersion: op.registry.schemaVersion } : { principalHash: await sha256(canonicalJson([op.issuer, op.subject])) }),
      planHash: await sha256(canonicalJson({ op, snapshot })) });
    this.#plans.set(plan, { op, snapshot, changeCount: changes.length });
    return plan;
  }

  async apply(plan: Plan, now = Date.now()): Promise<{ applied: boolean; changes: number }> {
    const pending = this.#plans.get(plan);
    if (!pending) return fail('invalid_plan', '이 도구가 만든 적용 계획이 필요해요.');
    const { op, snapshot } = pending;
    this.#plans.delete(plan);
    if (!Number.isSafeInteger(now) || now < 0) return fail('invalid_time', '적용 시각을 확인해 주세요.');
    if (!pending.changeCount) {
      if (canonicalJson(await this.#snapshot(op)) !== canonicalJson(snapshot))
        return fail('apply_conflict', 'DB 상태가 달라졌어요. 다시 미리보기를 확인해 주세요.');
      return { applied: false, changes: 0 };
    }
    const statements: SqlStatement[] = [];
    const id = projectId(op);
    const p = snapshot.project;
    if (p) {
      const conditions = ['ingest_revision = ?', 'name = ?', 'status = ?', 'time_zone = ?',
        'allowed_origins_json = ?', 'requests_per_minute = ?', 'new_receipts_per_utc_day = ?'];
      const args: SqlValue[] = [p.ingest_revision, p.name, p.status, p.time_zone, p.allowed_origins_json, p.requests_per_minute, p.new_receipts_per_utc_day];
      if (op.kind === 'register') {
        if (snapshot.schema) {
          conditions.push('EXISTS (SELECT 1 FROM project_schemas WHERE project_id = ? AND version = ? AND definitions_json = ? AND status = ?)');
          args.push(id, op.registry.schemaVersion, snapshot.schema.definitions_json, snapshot.schema.status);
        } else {
          conditions.push('NOT EXISTS (SELECT 1 FROM project_schemas WHERE project_id = ? AND version = ?)'); args.push(id, op.registry.schemaVersion);
        }
        conditions.push('(SELECT max(version) FROM project_schemas WHERE project_id = ?) IS ?'); args.push(id, snapshot.maxVersion);
      } else {
        conditions.push('grant_revision = ?'); args.push(p.grant_revision);
        conditions.push('(SELECT role FROM project_grants WHERE project_id = ? AND issuer = ? AND subject = ?) IS ?');
        args.push(id, op.issuer, op.subject, snapshot.role);
        conditions.push("(SELECT count(*) FROM project_grants WHERE project_id = ? AND role = 'owner') = ?"); args.push(id, snapshot.owners);
      }
      statements.push(this.#db.prepare(`UPDATE projects SET ingest_revision = CASE WHEN ${conditions.join(' AND ')}
        THEN ingest_revision + 1 ELSE -1 END WHERE id = ?`).bind(...args, id));
    }
    if (op.kind === 'register') {
      const r = op.registry;
      if (!p) statements.push(this.#db.prepare(`INSERT INTO projects
        (id, name, status, time_zone, allowed_origins_json, requests_per_minute, new_receipts_per_utc_day, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, r.project.name, r.project.status, r.project.timeZone,
          JSON.stringify(r.allowedOrigins), r.limits.requestsPerMinute, r.limits.newReceiptsPerUtcDay, now));
      else statements.push(this.#db.prepare(`UPDATE projects SET name = ?, status = ?, allowed_origins_json = ?,
        requests_per_minute = ?, new_receipts_per_utc_day = ? WHERE id = ?`).bind(r.project.name, r.project.status,
          JSON.stringify(r.allowedOrigins), r.limits.requestsPerMinute, r.limits.newReceiptsPerUtcDay, id));
      if (!snapshot.schema) statements.push(this.#db.prepare(`INSERT INTO project_schemas
        (project_id, version, status, definitions_json, published_at, retired_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, r.schemaVersion, r.schemaStatus, definitions(op), now, r.schemaStatus === 'retired' ? now : null));
      else if (snapshot.schema.status !== r.schemaStatus) statements.push(this.#db.prepare(`UPDATE project_schemas SET status = ?, retired_at = ? WHERE project_id = ? AND version = ?`)
        .bind(r.schemaStatus, r.schemaStatus === 'retired' ? now : null, id, r.schemaVersion));
    } else if (op.kind === 'grant') statements.push(this.#db.prepare(`INSERT INTO project_grants (project_id, issuer, subject, role, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, issuer, subject) DO UPDATE SET role = excluded.role`).bind(id, op.issuer, op.subject, op.role, now));
    else statements.push(this.#db.prepare('DELETE FROM project_grants WHERE project_id = ? AND issuer = ? AND subject = ?').bind(id, op.issuer, op.subject));
    // No authenticated human identity exists in this offline tool. Never attribute it to the grant target.
    if (op.kind === 'register') {
      const r = op.registry;
      if (!p) statements.push(adminChangeStatement(this.#db, id, null, { action: 'project.created' }, now, 'always'));
      else {
        const values: [AdminChangeField, unknown, unknown][] = [
          ['name', p.name, r.project.name], ['status', p.status, r.project.status],
          ['allowedOrigins', JSON.parse(p.allowed_origins_json).sort(), r.allowedOrigins],
          ['requestsPerMinute', p.requests_per_minute, r.limits.requestsPerMinute],
          ['newReceiptsPerUtcDay', p.new_receipts_per_utc_day, r.limits.newReceiptsPerUtcDay],
        ];
        const fields = values.filter(([, before, after]) => canonicalJson(before) !== canonicalJson(after)).map(([field]) => field);
        if (fields.length) statements.push(adminChangeStatement(this.#db, id, null, { action: 'project.settings_changed', fields }, now, 'always'));
      }
      if (!snapshot.schema || snapshot.schema.status !== r.schemaStatus) statements.push(adminChangeStatement(this.#db, id, null,
        { action: snapshot.schema ? 'schema.status_changed' : 'schema.published', schemaVersion: r.schemaVersion }, now, 'always'));
    } else statements.push(adminChangeStatement(this.#db, id, null, {
      action: op.role === null ? 'grant.revoked' : snapshot.role === null ? 'grant.created' : 'grant.role_changed',
      target: { issuer: op.issuer, subject: op.subject }, beforeRole: snapshot.role as GrantRole | null, afterRole: op.role,
    }, now, 'always'));
    try {
      const result = await this.#db.batch(statements);
      if (result.length !== statements.length || result.some(row => !row.success) || result[0]?.meta.changes !== 1) throw Error();
    } catch { return fail('apply_conflict', 'DB 상태가 달라졌거나 쓰기에 실패했어요. 다시 미리보기를 확인해 주세요.'); }
    return { applied: true, changes: pending.changeCount };
  }
}
