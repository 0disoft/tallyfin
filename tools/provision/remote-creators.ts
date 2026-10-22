import { canonicalJson, closed, integer, matches, sha256 } from '@tallyfin/core';
import { creatorOperation, type CreatorPlan } from './creators.ts';
import { ProvisionError } from './input.ts';

export type RemoteCreatorTarget = Readonly<{ accountId: string; databaseId: string; databaseName: string; workerName: string; issuer: string }>;
export type CreatorQuery = (sql: string) => Promise<unknown>;
type Snapshot = { maxProjects: number | null; grantedAt: number | null; createdProjects: number };
type Operation = ReturnType<typeof creatorOperation>;

/** Hex literals keep arbitrary Unicode identities out of SQL syntax, not secret or encrypted. */
function literal(value: string) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.toString('utf8') !== value) throw new ProvisionError('invalid_input', '계정 식별자의 문자 형식을 확인해 주세요.');
  return `CAST(X'${bytes.toString('hex')}' AS TEXT)`;
}
export function creatorRows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || value[0].success !== true || !Array.isArray(value[0].results))
    throw new ProvisionError('database_unavailable', 'DB 응답을 확인하지 못했어요. 반영 여부를 확인한 뒤 새 미리보기를 실행해 주세요.');
  return value[0].results;
}
export class RemoteCreatorProvisioner {
  #target: RemoteCreatorTarget;
  #query: CreatorQuery;
  #plans = new WeakMap<CreatorPlan, { op: Operation; snapshot: Snapshot }>();
  constructor(target: RemoteCreatorTarget, query: CreatorQuery) {
    if (!closed(target, ['accountId', 'databaseId', 'databaseName', 'workerName', 'issuer']) ||
      !matches(target.accountId, /^[0-9a-f]{32}$/) || /^0+$/.test(target.accountId) ||
      !matches(target.databaseId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) ||
      /^0+-0+-0+-0+-0+$/.test(target.databaseId) || !matches(target.databaseName, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) ||
      !matches(target.workerName, /^[a-z][a-z0-9-]{0,62}$/)) throw new ProvisionError('invalid_target', '검증한 설치 설정의 원격 DB 대상이 필요해요.');
    creatorOperation('creator-revoke', { issuer: target.issuer, subject: 'format-validation' });
    this.#target = Object.freeze({ ...target }); this.#query = query;
  }
  async #run(sql: string) {
    try { return creatorRows(await this.#query(sql)); }
    catch (error) {
      if (error instanceof ProvisionError && error.code === 'cleanup_failed')
        throw new ProvisionError('cleanup_failed', '임시 파일을 정리하지 못했어요. DB 반영 여부도 확인해 주세요.', { cause: error });
      throw new ProvisionError('database_unavailable', '원격 DB 응답을 확인하지 못했어요. 반영 여부를 확인한 뒤 새 미리보기를 실행해 주세요.', { cause: error });
    }
  }
  async #read(op: Operation): Promise<Snapshot> {
    const where = `issuer=${literal(op.issuer)} AND subject=${literal(op.subject)}`;
    const rows = await this.#run(`SELECT (SELECT max_projects FROM project_creators WHERE ${where}) AS maxProjects,
      (SELECT created_at FROM project_creators WHERE ${where}) AS grantedAt,
      (SELECT count(*) FROM project_creations WHERE ${where}) AS createdProjects`);
    const value = rows[0];
    if (rows.length !== 1 || !closed(value, ['maxProjects', 'grantedAt', 'createdProjects']) ||
      !(value.maxProjects === null && value.grantedAt === null || integer(value.maxProjects, 1, 1000) && integer(value.grantedAt, 0, 8640000000000000)) ||
      !integer(value.createdProjects, 0, Number.MAX_SAFE_INTEGER))
      throw new ProvisionError('database_unavailable', '생성 권한·사용량 응답이 올바르지 않아요. DB 상태를 확인해 주세요.');
    return { maxProjects: value.maxProjects as number | null, grantedAt: value.grantedAt as number | null, createdProjects: value.createdProjects as number };
  }
  async plan(kind: string, input: unknown): Promise<CreatorPlan> {
    const op = creatorOperation(kind, input);
    if (op.issuer !== this.#target.issuer) throw new ProvisionError('issuer_mismatch', '설치한 관리자 발급자의 계정만 등록할 수 있어요.');
    // Validate Unicode before making any remote request.
    literal(op.subject);
    const snapshot = await this.#read(op);
    const plan: CreatorPlan = { operation: op.kind, principalHash: await sha256(canonicalJson([op.issuer, op.subject])),
      maxProjects: snapshot.maxProjects, createdProjects: snapshot.createdProjects,
      changes: snapshot.maxProjects === op.maxProjects ? [] : [{ target: 'creator', field: 'maxProjects', before: snapshot.maxProjects, after: op.maxProjects }],
      planHash: await sha256(canonicalJson({ version: 'tallyfin.remote-creator/v1', target: this.#target, op, snapshot })) };
    this.#plans.set(plan, { op, snapshot }); return plan;
  }
  async apply(plan: CreatorPlan, now = Date.now()): Promise<{ applied: boolean; changes: number }> {
    const pending = this.#plans.get(plan);
    if (!pending) throw new ProvisionError('invalid_plan', '이 도구가 만든 적용 계획이 필요해요.');
    this.#plans.delete(plan);
    if (!integer(now, 0, 8640000000000000)) throw new ProvisionError('invalid_time', '적용 시각을 확인해 주세요.');
    const { op, snapshot } = pending;
    if (snapshot.maxProjects === op.maxProjects) {
      if (canonicalJson(await this.#read(op)) !== canonicalJson(snapshot)) throw new ProvisionError('apply_conflict', '상태가 달라졌어요. 새 미리보기를 확인해 주세요.');
      return { applied: false, changes: 0 };
    }
    const issuer = literal(op.issuer), subject = literal(op.subject);
    const where = `issuer=${issuer} AND subject=${subject}`;
    const count = `(SELECT count(*) FROM project_creations WHERE ${where})=${snapshot.createdProjects}`;
    const current = `${where} AND max_projects=${snapshot.maxProjects} AND created_at=${snapshot.grantedAt} AND ${count}`;
    const sql = snapshot.maxProjects === null
      ? `INSERT INTO project_creators(issuer,subject,max_projects,created_at) SELECT ${issuer},${subject},${op.maxProjects},${now}
        WHERE NOT EXISTS(SELECT 1 FROM project_creators WHERE ${where}) AND ${count} RETURNING 1 AS changed`
      : op.maxProjects === null ? `DELETE FROM project_creators WHERE ${current} RETURNING 1 AS changed`
      : `UPDATE project_creators SET max_projects=${op.maxProjects} WHERE ${current} RETURNING 1 AS changed`;
    const rows = await this.#run(sql);
    if (!rows.length) throw new ProvisionError('apply_conflict', '권한이나 사용량이 달라졌어요. 새 미리보기를 확인해 주세요.');
    if (rows.length !== 1 || !closed(rows[0], ['changed']) || rows[0].changed !== 1)
      throw new ProvisionError('database_unavailable', '변경 응답을 확인하지 못했어요. 반영 여부부터 확인해 주세요.');
    return { applied: true, changes: 1 };
  }
}
