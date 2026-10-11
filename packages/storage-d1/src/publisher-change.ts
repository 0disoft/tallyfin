import { CollectionError, integer, PROJECT_ID, validPublisherGrantId, validatePublisherChange } from '@tallyfin/core';
import type { AdminPrincipal, PublisherChange, PublisherChangeResult } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';
import { adminChangeStatement } from './admin-changes.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants a WHERE a.project_id = p.id AND a.issuer = ? AND a.subject = ? AND a.role = 'owner')";
interface StateRow { created_at: number | null; grant_id: string | null }
export async function changeProjectPublisher(db: SqlDatabase, principal: AdminPrincipal, id: string,
  input: PublisherChange, now: number): Promise<PublisherChangeResult> {
  if (!PROJECT_ID.test(id) || !integer(now, 0, 253402300799999)) throw new CollectionError('invalid_request', 400);
  const change = validatePublisherChange(input), caller = [principal.issuer, principal.subject], target = [change.issuer, change.subject];
  const mutation = change.granted
    ? db.prepare(`INSERT INTO project_publishers (project_id,issuer,subject,created_at)
        SELECT p.id,?,?,? FROM projects p WHERE p.id=? AND ${owner}
        ON CONFLICT(project_id,issuer,subject) DO NOTHING`).bind(...target, now, id, ...caller)
    : db.prepare(`DELETE FROM project_publishers WHERE project_id=? AND issuer=? AND subject=? AND grant_id IS ?
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id=? AND ${owner})`).bind(id, ...target, change.expectedGrantId, id, ...caller);
  // Recheck ownership inside the same transaction as permission, history and response metadata.
  const results = await db.batch<{ id: string } | StateRow>([
    db.prepare(`SELECT p.id FROM projects p WHERE p.id=? AND ${owner}`).bind(id, ...caller),
    mutation,
    adminChangeStatement(db, id, principal, { action: change.granted ? 'publisher.granted' : 'publisher.revoked',
      target: { issuer: change.issuer, subject: change.subject } }, now),
    db.prepare(`SELECT g.created_at,g.grant_id FROM projects p LEFT JOIN project_publishers g
      ON g.project_id=p.id AND g.issuer=? AND g.subject=? WHERE p.id=? AND ${owner}`).bind(...target, id, ...caller),
  ]);
  if (results.length !== 4 || results.some(row => !row.success || !Array.isArray(row.results))) throw new CollectionError('storage_unavailable', 503);
  if (!results[0]!.results.length) throw new CollectionError('forbidden', 403);
  const state = results[3]!.results[0] as StateRow | undefined, changed = results[1]!.meta.changes;
  if (results[0]!.results.length !== 1 || !state || results[3]!.results.length !== 1 || !integer(changed, 0, 1) ||
    results[2]!.meta.changes !== changed || (state.created_at === null ? state.grant_id !== null :
      !integer(state.created_at, 0, 253402300799999) || !validPublisherGrantId(state.grant_id)))
    throw new CollectionError('storage_unavailable', 503);
  if ((state.created_at !== null) !== change.granted)
    throw new CollectionError(change.granted ? 'storage_unavailable' : 'publisher_conflict', change.granted ? 503 : 409);
  return { projectId: id, issuer: change.issuer, subject: change.subject, granted: change.granted,
    createdAt: state.created_at === null ? null : new Date(state.created_at).toISOString(), grantId: state.grant_id, changed: changed === 1 };
}
