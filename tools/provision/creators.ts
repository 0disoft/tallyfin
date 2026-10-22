import { canonicalJson, closed, integer, sha256, text } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { ProvisionError } from './input.ts';

type Operation = { kind: 'creator-grant' | 'creator-revoke'; issuer: string; subject: string; maxProjects: number | null };
type Snapshot = { maxProjects: number | null; createdProjects: number };
export interface CreatorPlan { operation: string; principalHash: string; maxProjects: number | null; createdProjects: number;
  changes: { target: 'creator'; field: 'maxProjects'; before: number | null; after: number | null }[]; planHash: string }
export function creatorOperation(kind: string, value: unknown): Operation {
  try {
    if (!['creator-grant', 'creator-revoke'].includes(kind) || !closed(value, ['issuer', 'subject', ...(kind === 'creator-grant' ? ['maxProjects'] : [])]) ||
      !text(value.issuer, 1, 512) || value.issuer !== value.issuer.trim() || !text(value.subject, 1, 512) || !value.subject.trim() ||
      /[\x00-\x1f\x7f]/.test(value.subject) || (kind === 'creator-grant' && !integer(value.maxProjects, 1, 1000))) throw Error();
    const issuer = new URL(value.issuer);
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) throw Error();
    return { kind: kind as Operation['kind'], issuer: value.issuer, subject: value.subject, maxProjects: kind === 'creator-grant' ? value.maxProjects as number : null };
  } catch { throw new ProvisionError('invalid_input', '생성 권한의 issuer·subject·프로젝트 한도를 확인해 주세요.'); }
}
export class CreatorProvisioner {
  #db: SqlDatabase;
  #plans = new WeakMap<CreatorPlan, { op: Operation; snapshot: Snapshot }>();
  constructor(db: SqlDatabase) { this.#db = db; }
  async #read(op: Operation): Promise<Snapshot> {
    const result = await this.#db.batch<{ max_projects: number } | { n: number }>([
      this.#db.prepare('SELECT max_projects FROM project_creators WHERE issuer = ? AND subject = ?').bind(op.issuer, op.subject),
      this.#db.prepare('SELECT count(*) AS n FROM project_creations WHERE issuer = ? AND subject = ?').bind(op.issuer, op.subject),
    ]);
    if (result.length !== 2 || result.some(r => !r.success || !Array.isArray(r.results))) throw Error();
    return { maxProjects: (result[0]!.results[0] as { max_projects: number } | undefined)?.max_projects ?? null,
      createdProjects: (result[1]!.results[0] as { n: number }).n };
  }
  async plan(kind: string, input: unknown): Promise<CreatorPlan> {
    const op = creatorOperation(kind, input);
    let snapshot: Snapshot;
    try { snapshot = await this.#read(op); }
    catch (cause) { throw new ProvisionError('database_unavailable', '생성 권한을 읽지 못했어요. init과 DB 경로를 확인해 주세요.', { cause }); }
    const plan: CreatorPlan = { operation: op.kind, principalHash: await sha256(canonicalJson([op.issuer, op.subject])),
      ...snapshot, changes: snapshot.maxProjects === op.maxProjects ? [] : [{ target: 'creator', field: 'maxProjects', before: snapshot.maxProjects, after: op.maxProjects }],
      planHash: await sha256(canonicalJson({ op, snapshot })) };
    this.#plans.set(plan, { op, snapshot }); return plan;
  }
  async apply(plan: CreatorPlan, now = Date.now()): Promise<{ applied: boolean; changes: number }> {
    const pending = this.#plans.get(plan);
    if (!pending) throw new ProvisionError('invalid_plan', '이 도구가 만든 적용 계획이 필요해요.');
    this.#plans.delete(plan);
    if (!integer(now, 0, 8640000000000000)) throw new ProvisionError('invalid_time', '적용 시각을 확인해 주세요.');
    const { op, snapshot } = pending;
    try {
      if (snapshot.maxProjects === op.maxProjects) {
        if (canonicalJson(await this.#read(op)) !== canonicalJson(snapshot))
          throw new ProvisionError('apply_conflict', '생성 권한이나 사용량이 달라졌어요. 새 미리보기를 확인해 주세요.');
        return { applied: false, changes: 0 };
      }
      const count = '(SELECT count(*) FROM project_creations WHERE issuer = ? AND subject = ?) = ?';
      let statement;
      if (snapshot.maxProjects === null) statement = this.#db.prepare(`INSERT INTO project_creators (issuer,subject,max_projects,created_at)
        SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM project_creators WHERE issuer = ? AND subject = ?) AND ${count}`)
        .bind(op.issuer, op.subject, op.maxProjects, now, op.issuer, op.subject, op.issuer, op.subject, snapshot.createdProjects);
      else if (op.maxProjects === null) statement = this.#db.prepare(`DELETE FROM project_creators WHERE issuer = ? AND subject = ? AND max_projects = ? AND ${count}`)
        .bind(op.issuer, op.subject, snapshot.maxProjects, op.issuer, op.subject, snapshot.createdProjects);
      else statement = this.#db.prepare(`UPDATE project_creators SET max_projects = ? WHERE issuer = ? AND subject = ? AND max_projects = ? AND ${count}`)
        .bind(op.maxProjects, op.issuer, op.subject, snapshot.maxProjects, op.issuer, op.subject, snapshot.createdProjects);
      const result = await this.#db.batch([statement]);
      if (result.length !== 1 || !result[0]?.success || !integer(result[0].meta.changes, 0, 1)) throw Error('Invalid database response');
      if (result[0].meta.changes === 0)
        throw new ProvisionError('apply_conflict', '생성 권한이나 사용량이 달라졌어요. 새 미리보기를 확인해 주세요.');
      return { applied: true, changes: 1 };
    } catch (cause) {
      if (cause instanceof ProvisionError) throw cause;
      throw new ProvisionError('database_unavailable', '적용 결과를 확인하지 못했어요. DB 반영 여부를 확인하고 새 미리보기를 실행해 주세요.', { cause });
    }
  }
}
