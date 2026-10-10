import { ADMIN_CHANGE_FIELDS, CollectionError, integer, PROJECT_ID, validGrantIdentity } from '@tallyfin/core';
import type { AdminChangeDetail, AdminPrincipal } from '@tallyfin/core';
import type { SqlDatabase, SqlStatement } from './sql.ts';

/** Must be included in the same batch as the mutation. Gate immediately after its write. */
export function adminChangeStatement(db: SqlDatabase, projectId: string, actor: AdminPrincipal | null,
  detail: AdminChangeDetail, now: number, gate: 'changed' | 'always' = 'changed'): SqlStatement {
  if (!PROJECT_ID.test(projectId) || !integer(now, 0, 8640000000000000) ||
    (actor !== null && !validGrantIdentity(actor.issuer, actor.subject))) throw new CollectionError('invalid_request', 400);
  const fields = detail.action === 'project.settings_changed' ? [...new Set(detail.fields)].sort() : [];
  if (detail.action === 'project.settings_changed' && (!fields.length || !fields.every(field => ADMIN_CHANGE_FIELDS.includes(field))))
    throw new CollectionError('invalid_request', 400);
  const schemaVersion = 'schemaVersion' in detail ? detail.schemaVersion : null;
  if (schemaVersion !== null && !integer(schemaVersion, 1, 2147483647)) throw new CollectionError('invalid_request', 400);
  const target = 'target' in detail ? detail.target : null;
  if (target && !validGrantIdentity(target.issuer, target.subject)) throw new CollectionError('invalid_request', 400);
  return db.prepare(`INSERT INTO admin_changes
    (id,project_id,occurred_at,actor_kind,actor_issuer,actor_subject,action,fields_json,schema_version,target_issuer,target_subject,before_role,after_role)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? ${gate === 'changed' ? 'WHERE changes() = 1' : ''}`)
    .bind(crypto.randomUUID(), projectId, now, actor ? 'administrator' : 'local_operator', actor?.issuer ?? null,
      actor?.subject ?? null, detail.action, JSON.stringify(fields), schemaVersion, target?.issuer ?? null,
      target?.subject ?? null, 'beforeRole' in detail ? detail.beforeRole : null, 'afterRole' in detail ? detail.afterRole : null);
}
