import { CollectionError, integer, PROJECT_ID, validateGrantChange } from '@tallyfin/core';
import type { AdminPrincipal, GrantChange, GrantChangeResult } from '@tallyfin/core';
import type { SqlDatabase, SqlStatement } from './sql.ts';
import { adminChangeStatement } from './admin-changes.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants a WHERE a.project_id = p.id AND a.issuer = ? AND a.subject = ? AND a.role = 'owner')";
const targetRole = '(SELECT role FROM project_grants WHERE project_id = p.id AND issuer = ? AND subject = ?)';
const ownerCount = "(SELECT COUNT(*) FROM project_grants WHERE project_id = p.id AND role = 'owner')";
interface StateRow { revision: number; role: 'reader' | 'owner' | null; created_at: number | null; owners: number; can_manage: number }

export async function changeProjectGrant(db: SqlDatabase, principal: AdminPrincipal, id: string,
  input: GrantChange, now: number): Promise<GrantChangeResult> {
  if (!PROJECT_ID.test(id) || !integer(now, 0, 8640000000000000)) throw new CollectionError('invalid_request', 400);
  const change = validateGrantChange(input), caller = [principal.issuer, principal.subject], target = [change.issuer, change.subject];
  let mutation: SqlStatement;
  if (change.role !== null) {
    mutation = db.prepare(`INSERT INTO project_grants (project_id, issuer, subject, role, created_at)
      SELECT p.id, ?, ?, ?, ? FROM projects p WHERE p.id = ? AND ${owner}
      AND p.grant_revision = ? AND ${targetRole} IS ? AND ${targetRole} IS NOT ?
      AND (? = 'owner' OR ${targetRole} IS NOT 'owner' OR ${ownerCount} > 1)
      ON CONFLICT(project_id, issuer, subject) DO UPDATE SET role = excluded.role`)
      .bind(...target, change.role, now, id, ...caller, change.expectedRevision ?? -1, ...target, change.expectedRole, ...target, change.role, change.role, ...target);
  } else {
    mutation = db.prepare(`DELETE FROM project_grants WHERE project_id = ? AND issuer = ? AND subject = ? AND role IS ?
      AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ? AND ${owner} AND p.grant_revision = ?)
      AND (role <> 'owner' OR (SELECT COUNT(*) FROM project_grants WHERE project_id = ? AND role = 'owner') > 1)`)
      .bind(id, ...target, change.expectedRole, id, ...caller, change.expectedRevision ?? -1, id);
  }
  // Authorization, compare-and-swap, last-owner protection and the result share one transaction.
  // The first read preserves authorization for the response when an owner changes their own grant.
  const results = await db.batch<{ id: string; revision: number } | StateRow>([
    db.prepare(`SELECT p.id, p.grant_revision AS revision FROM projects p WHERE p.id = ? AND ${owner}`).bind(id, ...caller),
    mutation,
    adminChangeStatement(db, id, principal, {
      action: change.role === null ? 'grant.revoked' : change.expectedRole === null ? 'grant.created' : 'grant.role_changed',
      target: { issuer: change.issuer, subject: change.subject }, beforeRole: change.expectedRole, afterRole: change.role,
    }, now),
    db.prepare(`SELECT p.grant_revision AS revision, ${targetRole} AS role,
      (SELECT created_at FROM project_grants WHERE project_id = p.id AND issuer = ? AND subject = ?) AS created_at,
      ${ownerCount} AS owners, ${owner} AS can_manage FROM projects p WHERE p.id = ?`)
      .bind(...target, ...target, ...caller, id),
  ]);
  if (results.length !== 4 || results.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!results[0]!.results.length) throw new CollectionError('forbidden', 403);
  const before = results[0]!.results[0] as { revision: number };
  const state = results[3]!.results[0] as StateRow | undefined;
  // Compare the transactional revisions, not the driver's accounting of trigger writes.
  const changed = state ? state.revision - before.revision : -1;
  if (!integer(before.revision, 0, Number.MAX_SAFE_INTEGER) || !state || !integer(state.revision, 0, Number.MAX_SAFE_INTEGER) || !integer(changed, 0, 1) ||
    (results[1]!.meta.changes === 0) !== (changed === 0) || results[2]!.meta.changes !== changed || !integer(state.owners, 1, Number.MAX_SAFE_INTEGER) || !integer(state.can_manage, 0, 1) ||
    (state.role !== null && state.role !== 'reader' && state.role !== 'owner') ||
    (state.role === null ? state.created_at !== null : !integer(state.created_at, 0, 8640000000000000)))
    throw new CollectionError('storage_unavailable', 503);
  if (state.role !== change.role) {
    if (state.role !== change.expectedRole || state.revision !== change.expectedRevision) throw new CollectionError('grant_conflict', 409);
    if (state.role === 'owner' && state.owners === 1) throw new CollectionError('last_owner', 409);
    throw new CollectionError('storage_unavailable', 503);
  }
  return { projectId: id, issuer: change.issuer, subject: change.subject,
    role: state.role, createdAt: state.created_at === null ? null : new Date(state.created_at).toISOString(),
    canManage: state.can_manage === 1, changed: changed === 1 };
}
