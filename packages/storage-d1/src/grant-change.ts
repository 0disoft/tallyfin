import { CollectionError, integer, PROJECT_ID, validateGrantChange } from '@tallyfin/core';
import type { AdminPrincipal, GrantChange, GrantChangeResult } from '@tallyfin/core';
import type { SqlDatabase, SqlStatement } from './sql.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants a WHERE a.project_id = p.id AND a.issuer = ? AND a.subject = ? AND a.role = 'owner')";
const targetRole = '(SELECT role FROM project_grants WHERE project_id = p.id AND issuer = ? AND subject = ?)';
const ownerCount = "(SELECT COUNT(*) FROM project_grants WHERE project_id = p.id AND role = 'owner')";
interface StateRow { role: 'reader' | 'owner' | null; created_at: number | null; owners: number; can_manage: number }

export async function changeProjectGrant(db: SqlDatabase, principal: AdminPrincipal, id: string,
  input: GrantChange, now: number): Promise<GrantChangeResult> {
  if (!PROJECT_ID.test(id) || !integer(now, 0, 8640000000000000)) throw new CollectionError('invalid_request', 400);
  const change = validateGrantChange(input), caller = [principal.issuer, principal.subject], target = [change.issuer, change.subject];
  let mutation: SqlStatement;
  if (change.role !== null) {
    mutation = db.prepare(`INSERT INTO project_grants (project_id, issuer, subject, role, created_at)
      SELECT p.id, ?, ?, ?, ? FROM projects p WHERE p.id = ? AND ${owner}
      AND ${targetRole} IS ? AND ${targetRole} IS NOT ?
      AND (? = 'owner' OR ${targetRole} IS NOT 'owner' OR ${ownerCount} > 1)
      ON CONFLICT(project_id, issuer, subject) DO UPDATE SET role = excluded.role`)
      .bind(...target, change.role, now, id, ...caller, ...target, change.expectedRole, ...target, change.role, change.role, ...target);
  } else {
    mutation = db.prepare(`DELETE FROM project_grants WHERE project_id = ? AND issuer = ? AND subject = ? AND role IS ?
      AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ? AND ${owner})
      AND (role <> 'owner' OR (SELECT COUNT(*) FROM project_grants WHERE project_id = ? AND role = 'owner') > 1)`)
      .bind(id, ...target, change.expectedRole, id, ...caller, id);
  }
  // Authorization, compare-and-swap, last-owner protection and the result share one transaction.
  // The first read preserves authorization for the response when an owner changes their own grant.
  const results = await db.batch<{ id: string } | StateRow>([
    db.prepare(`SELECT p.id FROM projects p WHERE p.id = ? AND ${owner}`).bind(id, ...caller),
    mutation,
    db.prepare(`SELECT ${targetRole} AS role,
      (SELECT created_at FROM project_grants WHERE project_id = p.id AND issuer = ? AND subject = ?) AS created_at,
      ${ownerCount} AS owners, ${owner} AS can_manage FROM projects p WHERE p.id = ?`)
      .bind(...target, ...target, ...caller, id),
  ]);
  if (results.length !== 3 || results.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!results[0]!.results.length) throw new CollectionError('forbidden', 403);
  const state = results[2]!.results[0] as StateRow | undefined, changed = results[1]!.meta.changes;
  if (!state || !integer(changed, 0, 1) || !integer(state.owners, 1, Number.MAX_SAFE_INTEGER) || !integer(state.can_manage, 0, 1) ||
    (state.role !== null && state.role !== 'reader' && state.role !== 'owner') ||
    (state.role === null ? state.created_at !== null : !integer(state.created_at, 0, 8640000000000000)))
    throw new CollectionError('storage_unavailable', 503);
  if (state.role !== change.role) {
    if (state.role !== change.expectedRole) throw new CollectionError('grant_conflict', 409);
    if (state.role === 'owner' && state.owners === 1) throw new CollectionError('last_owner', 409);
    throw new CollectionError('storage_unavailable', 503);
  }
  return { projectId: id, issuer: change.issuer, subject: change.subject,
    role: state.role, createdAt: state.created_at === null ? null : new Date(state.created_at).toISOString(),
    canManage: state.can_manage === 1, changed: changed === 1 };
}
