import { CollectionError, integer, parseProjectCreation, projectCreationHash } from '@tallyfin/core';
import type { AdminPrincipal, CreatedProject } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';
import { adminChangeStatement } from './admin-changes.ts';

type AccessRow = { max_projects: number; created_projects: number };
const permission = `SELECT c.max_projects, (SELECT count(*) FROM project_creations r WHERE r.issuer = c.issuer AND r.subject = c.subject) AS created_projects
  FROM project_creators c WHERE c.issuer = ? AND c.subject = ?`;
function access(row: AccessRow | undefined) {
  if (!row) throw new CollectionError('forbidden', 403);
  if (!integer(row.max_projects, 1, 1000) || !integer(row.created_projects, 0, Number.MAX_SAFE_INTEGER))
    throw new CollectionError('storage_unavailable', 503);
  return row;
}
export async function projectCreationAccess(db: SqlDatabase, principal: AdminPrincipal): Promise<void> {
  const result = await db.batch<AccessRow>([db.prepare(permission).bind(principal.issuer, principal.subject)]);
  if (result.length !== 1 || !result[0]?.success || !Array.isArray(result[0].results)) throw new CollectionError('storage_unavailable', 503);
  access(result[0].results[0]);
}
export async function createProject(db: SqlDatabase, principal: AdminPrincipal, input: unknown, now: number,
  options: { allowLocalHttp?: boolean } = {}): Promise<CreatedProject> {
  await projectCreationAccess(db, principal);
  const value = parseProjectCreation(input, options), hash = await projectCreationHash(value);
  if (!integer(now, 0, 8640000000000000)) throw new CollectionError('invalid_request', 400);
  // Permission and quota are checked in the INSERT, in the same transaction as the initial owner grant.
  const result = await db.batch<AccessRow | { request_hash: string; created_at: number; role: string | null }>([
    db.prepare(`INSERT INTO projects (id,name,status,time_zone,allowed_origins_json,requests_per_minute,new_receipts_per_utc_day,created_at)
      SELECT ?,?,'active',?,?,?,?,? FROM project_creators c WHERE c.issuer = ? AND c.subject = ?
      AND (SELECT count(*) FROM project_creations r WHERE r.issuer = c.issuer AND r.subject = c.subject) < c.max_projects
      AND NOT EXISTS (SELECT 1 FROM projects WHERE id = ?)`)
      .bind(value.id, value.name, value.timeZone, JSON.stringify(value.allowedOrigins), value.limits.requestsPerMinute,
        value.limits.newReceiptsPerUtcDay, now, principal.issuer, principal.subject, value.id),
    db.prepare('INSERT INTO project_creations (project_id,issuer,subject,request_hash,created_at) SELECT ?,?,?,?,? WHERE changes() = 1')
      .bind(value.id, principal.issuer, principal.subject, hash, now),
    db.prepare("INSERT INTO project_grants (project_id,issuer,subject,role,created_at) SELECT ?,?,?,'owner',? WHERE changes() = 1")
      .bind(value.id, principal.issuer, principal.subject, now),
    adminChangeStatement(db, value.id, principal, { action: 'project.created' }, now),
    db.prepare(`SELECT r.request_hash, r.created_at, g.role FROM project_creations r LEFT JOIN project_grants g
      ON g.project_id = r.project_id AND g.issuer = r.issuer AND g.subject = r.subject
      WHERE r.project_id = ? AND r.issuer = ? AND r.subject = ?`).bind(value.id, principal.issuer, principal.subject),
    db.prepare(permission).bind(principal.issuer, principal.subject),
  ]);
  if (result.length !== 6 || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!integer(result[0]!.meta.changes, 0, 1) || [result[1]!, result[3]!].some(r => r.meta.changes !== result[0]!.meta.changes) || !integer(result[2]!.meta.changes, result[0]!.meta.changes, 2 * result[0]!.meta.changes))
    throw new CollectionError('storage_unavailable', 503);
  const allowed = access(result[5]!.results[0] as AccessRow | undefined);
  const receipt = result[4]!.results[0] as { request_hash: string; created_at: number; role: string | null } | undefined;
  if (receipt) {
    if (receipt.role !== 'owner') throw new CollectionError('forbidden', 403);
    if (receipt.request_hash !== hash) throw new CollectionError('project_conflict', 409);
    return { projectId: value.id, createdAt: new Date(receipt.created_at).toISOString(), creationHash: hash };
  }
  if (allowed.created_projects >= allowed.max_projects) throw new CollectionError('project_limit_reached', 409);
  throw new CollectionError('project_conflict', 409);
}
