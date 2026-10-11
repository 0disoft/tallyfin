import { canonicalJson, closed, integer, PROJECT_ID, sha256, validGrantIdentity } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { adminChangeStatement } from '@tallyfin/storage-d1';
import { ProvisionError } from './input.ts';

type Operation = { kind: 'publisher-grant' | 'publisher-revoke'; projectId: string; issuer: string; subject: string };
type Snapshot = { projectCreatedAt: number; publisherCreatedAt: number | null };
export interface PublisherPlan {
  operation: Operation['kind']; projectId: string; principalHash: string;
  granted: boolean;
  changes: { target: 'publisher'; field: 'granted'; before: boolean; after: boolean }[];
  planHash: string;
}
export function publisherOperation(kind: string, value: unknown): Operation {
  if (!['publisher-grant', 'publisher-revoke'].includes(kind) || !closed(value, ['projectId', 'issuer', 'subject']) ||
    typeof value.projectId !== 'string' || !PROJECT_ID.test(value.projectId) || !validGrantIdentity(value.issuer, value.subject))
    throw new ProvisionError('invalid_input', '프로젝트 ID와 발행자의 issuer·subject를 확인해 주세요.');
  return { kind: kind as Operation['kind'], projectId: value.projectId, issuer: value.issuer as string, subject: value.subject as string };
}

/** Trusted local DB operator only. Publisher permission does not confer administrator rights. */
export class PublisherProvisioner {
  #db: SqlDatabase;
  #plans = new WeakMap<PublisherPlan, { op: Operation; snapshot: Snapshot }>();
  constructor(db: SqlDatabase) { this.#db = db; }
  async #read(op: Operation): Promise<Snapshot> {
    const rows = await this.#db.batch<{ created_at: number }>([
      this.#db.prepare('SELECT created_at FROM projects WHERE id=?').bind(op.projectId),
      this.#db.prepare('SELECT created_at FROM project_publishers WHERE project_id=? AND issuer=? AND subject=?')
        .bind(op.projectId, op.issuer, op.subject),
    ]);
    if (rows.length !== 2 || rows.some(r => !r.success || !Array.isArray(r.results) || r.results.length > 1)) throw Error();
    if (!rows[0]!.results.length) throw new ProvisionError('project_not_found', '먼저 프로젝트를 등록해 주세요.');
    const projectCreatedAt = rows[0]!.results[0]!.created_at;
    const publisherCreatedAt = rows[1]!.results.length ? rows[1]!.results[0]!.created_at : null;
    if (!integer(projectCreatedAt, 0, 8640000000000000) ||
      (publisherCreatedAt !== null && !integer(publisherCreatedAt, 0, 8640000000000000))) throw Error();
    return { projectCreatedAt, publisherCreatedAt };
  }
  async plan(kind: string, input: unknown): Promise<PublisherPlan> {
    const op = publisherOperation(kind, input);
    let snapshot: Snapshot;
    try { snapshot = await this.#read(op); }
    catch (error) {
      if (error instanceof ProvisionError) throw error;
      throw new ProvisionError('database_unavailable', '발행 권한을 읽지 못했어요. init과 DB 경로를 확인해 주세요.');
    }
    const granted = snapshot.publisherCreatedAt !== null; const after = op.kind === 'publisher-grant';
    const plan: PublisherPlan = { operation: op.kind, projectId: op.projectId,
      principalHash: await sha256(canonicalJson([op.issuer, op.subject])), granted,
      changes: granted === after ? [] : [{ target: 'publisher', field: 'granted', before: granted, after }],
      planHash: await sha256(canonicalJson({ op, snapshot })) };
    this.#plans.set(plan, { op, snapshot }); return plan;
  }
  async apply(plan: PublisherPlan, now = Date.now()): Promise<{ applied: boolean; changes: number }> {
    const pending = this.#plans.get(plan);
    if (!pending) throw new ProvisionError('invalid_plan', '이 도구가 만든 적용 계획이 필요해요.');
    this.#plans.delete(plan);
    if (!integer(now, 0, 8640000000000000)) throw new ProvisionError('invalid_time', '적용 시각을 확인해 주세요.');
    const { op, snapshot } = pending;
    const after = op.kind === 'publisher-grant';
    const conflict = () => new ProvisionError('apply_conflict', '프로젝트나 발행 권한이 달라졌어요. 새 미리보기를 확인해 주세요.');
    try {
      if ((snapshot.publisherCreatedAt !== null) === after) {
        if (canonicalJson(await this.#read(op)) !== canonicalJson(snapshot)) throw conflict();
        return { applied: false, changes: 0 };
      }
      const project = 'EXISTS (SELECT 1 FROM projects WHERE id=? AND created_at=?)';
      const statement = after
        ? this.#db.prepare(`INSERT INTO project_publishers (project_id,issuer,subject,created_at)
          SELECT ?,?,?,? WHERE ${project} AND NOT EXISTS
          (SELECT 1 FROM project_publishers WHERE project_id=? AND issuer=? AND subject=?)`)
          .bind(op.projectId, op.issuer, op.subject, now, op.projectId, snapshot.projectCreatedAt, op.projectId, op.issuer, op.subject)
        : this.#db.prepare(`DELETE FROM project_publishers WHERE project_id=? AND issuer=? AND subject=? AND created_at=? AND ${project}`)
          .bind(op.projectId, op.issuer, op.subject, snapshot.publisherCreatedAt, op.projectId, snapshot.projectCreatedAt);
      const rows = await this.#db.batch([statement, adminChangeStatement(this.#db, op.projectId, null, {
        action: after ? 'publisher.granted' : 'publisher.revoked', target: { issuer: op.issuer, subject: op.subject },
      }, now)]);
      if (rows.length !== 2 || rows.some(row => !row.success) || !integer(rows[0]!.meta?.changes, 0, 1) ||
        rows[1]!.meta.changes !== rows[0]!.meta.changes) throw Error();
      if (rows[0]!.meta.changes !== 1) throw conflict();
      return { applied: true, changes: 1 };
    } catch (error) {
      if (error instanceof ProvisionError && error.code === 'apply_conflict') throw error;
      if (error instanceof ProvisionError && error.code === 'project_not_found') throw conflict();
      throw new ProvisionError('database_unavailable', '발행 권한 적용 결과를 확인하지 못했어요. DB 상태를 확인하고 새 미리보기를 실행해 주세요.');
    }
  }
}
