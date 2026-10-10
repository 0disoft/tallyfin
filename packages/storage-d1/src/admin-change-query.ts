import { ADMIN_CHANGE_FIELDS, ADMIN_CHANGE_RETENTION_DAYS, CollectionError, DAY, integer, PROJECT_ID, UUID, validGrantIdentity } from '@tallyfin/core';
import type { AdminChange, AdminChangeActor, AdminChangeDetail, AdminChangeField, AdminChangePage, AdminPrincipal, GrantRole } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants a WHERE a.project_id = p.id AND a.issuer = ? AND a.subject = ? AND a.role = 'owner')";
interface HistoryRow {
  id: string; occurred_at: number; actor_kind: string; actor_issuer: string | null; actor_subject: string | null;
  action: string; fields_json: string; schema_version: number | null; target_issuer: string | null; target_subject: string | null;
  before_role: GrantRole | null; after_role: GrantRole | null;
}
const storageError = (): never => { throw new CollectionError('storage_unavailable', 503); };
function encode(project: string, time: number, id: string): string {
  return btoa(JSON.stringify([1, project, time, id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(project: string, cursor: string): [number, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const value: unknown = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== project ||
      !integer(value[2], 0, 8640000000000000) || typeof value[3] !== 'string' || !UUID.test(value[3]) ||
      encode(project, value[2], value[3]) !== cursor) throw Error();
    return [value[2], value[3]];
  } catch { throw new CollectionError('invalid_request', 400); }
}
function metadata(row: HistoryRow, cutoff: number, now: number): AdminChange {
  if (typeof row.id !== 'string' || !UUID.test(row.id) || !integer(row.occurred_at, cutoff, now)) return storageError();
  let actor: AdminChangeActor;
  if (row.actor_kind === 'administrator' && validGrantIdentity(row.actor_issuer, row.actor_subject))
    actor = { kind: 'administrator', issuer: row.actor_issuer!, subject: row.actor_subject! };
  else if (row.actor_kind === 'local_operator' && row.actor_issuer === null && row.actor_subject === null) actor = { kind: 'local_operator' };
  else return storageError();
  let fields: unknown;
  if (typeof row.fields_json !== 'string' || row.fields_json.length > 256) return storageError();
  try { fields = JSON.parse(row.fields_json); } catch { return storageError(); }
  if (!Array.isArray(fields) || fields.length > 5 || new Set(fields).size !== fields.length ||
    !fields.every(field => ADMIN_CHANGE_FIELDS.includes(field))) return storageError();
  let change: AdminChangeDetail;
  if (row.action === 'project.created') change = { action: row.action };
  else if (row.action === 'project.settings_changed' && fields.length) change = { action: row.action, fields: fields as AdminChangeField[] };
  else if ((row.action === 'schema.published' || row.action === 'schema.status_changed') && integer(row.schema_version, 1, 2147483647))
    change = { action: row.action, schemaVersion: row.schema_version };
  else if (['grant.created', 'grant.role_changed', 'grant.revoked'].includes(row.action) && validGrantIdentity(row.target_issuer, row.target_subject) &&
    [null, 'reader', 'owner'].includes(row.before_role) && [null, 'reader', 'owner'].includes(row.after_role) &&
    (row.action === 'grant.created' ? row.before_role === null && row.after_role !== null :
      row.action === 'grant.revoked' ? row.before_role !== null && row.after_role === null :
      row.before_role !== null && row.after_role !== null && row.before_role !== row.after_role))
    change = { action: row.action as 'grant.created' | 'grant.role_changed' | 'grant.revoked',
      target: { issuer: row.target_issuer!, subject: row.target_subject! }, beforeRole: row.before_role, afterRole: row.after_role };
  else return storageError();
  if (change.action !== 'project.settings_changed' && fields.length ||
    !('schemaVersion' in change) && row.schema_version !== null ||
    !('target' in change) && [row.target_issuer, row.target_subject, row.before_role, row.after_role].some(value => value !== null)) return storageError();
  return { id: row.id, occurredAt: new Date(row.occurred_at).toISOString(), actor, change };
}
export async function listAdminChanges(db: SqlDatabase, principal: AdminPrincipal, id: string, limit: number,
  cursor: string, now: number): Promise<AdminChangePage> {
  if (!PROJECT_ID.test(id) || !integer(limit, 1, 100) || !integer(now, 0, 253402300799999)) throw new CollectionError('invalid_request', 400);
  const before = decode(id, cursor), cutoff = Math.max(0, now - ADMIN_CHANGE_RETENTION_DAYS * DAY), caller = [principal.issuer, principal.subject];
  // Authorization and projected rows share one transactional snapshot; pagination never grants access.
  const result = await db.batch<{ id: string } | HistoryRow>([
    db.prepare(`SELECT p.id FROM projects p WHERE p.id = ? AND ${owner}`).bind(id, ...caller),
    db.prepare(`SELECT h.id,h.occurred_at,h.actor_kind,h.actor_issuer,h.actor_subject,h.action,h.fields_json,h.schema_version,
      h.target_issuer,h.target_subject,h.before_role,h.after_role FROM admin_changes h JOIN projects p ON p.id = h.project_id
      WHERE p.id = ? AND ${owner} AND h.occurred_at >= ? AND h.occurred_at <= ?
      ${before ? 'AND (h.occurred_at, h.id) < (?, ?)' : ''}
      ORDER BY h.occurred_at DESC, h.id DESC LIMIT ?`).bind(id, ...caller, cutoff, now, ...(before ?? []), limit + 1),
  ]);
  if (result.length !== 2 || result.some(r => !r.success || !Array.isArray(r.results))) return storageError();
  if (!result[0]!.results.length) throw new CollectionError('forbidden', 403);
  if (result[0]!.results.length !== 1) return storageError();
  if ((result[0]!.results[0] as { id: string }).id !== id) return storageError();
  const rows = result[1]!.results as HistoryRow[];
  if (rows.length > limit + 1) return storageError();
  const data = rows.map(row => metadata(row, cutoff, now));
  if (new Set(data.map(row => row.id)).size !== data.length) return storageError();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!, previous = i === 0 ? before : [rows[i - 1]!.occurred_at, rows[i - 1]!.id] as const;
    if (previous && !(row.occurred_at < previous[0] || row.occurred_at === previous[0] && row.id < previous[1])) return storageError();
  }
  const last = rows[limit - 1];
  return { projectId: id, generatedAt: new Date(now).toISOString(), retentionDays: ADMIN_CHANGE_RETENTION_DAYS,
    coverage: 'recorded-changes-only', data: data.slice(0, limit), page: { limit,
      nextCursor: rows.length > limit && last ? encode(id, last.occurred_at, last.id) : null } };
}
