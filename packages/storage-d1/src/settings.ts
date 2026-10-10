import { CollectionError, parseSettingsUpdate, PROJECT_ID, settingsHash, validateMutableSettings } from '@tallyfin/core';
import type { AdminChangeField, AdminPrincipal, ProjectSettings, ProjectSettingsUpdate } from '@tallyfin/core';
import type { ProjectRow, SqlDatabase } from './sql.ts';
import { adminChangeStatement } from './admin-changes.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = p.id AND g.issuer = ? AND g.subject = ? AND g.role = 'owner')";
type Options = { allowLocalHttp?: boolean };
type SettingsRow = ProjectRow & { role: 'owner' | 'reader' };
async function read(db: SqlDatabase, principal: AdminPrincipal, id: string, write: boolean): Promise<SettingsRow> {
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  const result = await db.batch<SettingsRow>([db.prepare(`SELECT p.*, g.role FROM projects p JOIN project_grants g
    ON g.project_id = p.id AND g.issuer = ? AND g.subject = ? WHERE p.id = ? AND ${write ? "g.role = 'owner'" : "g.role IN ('reader','owner')"}`)
    .bind(principal.issuer, principal.subject, id)]);
  if (result.length !== 1 || !result[0]?.success || !Array.isArray(result[0].results)) throw new CollectionError('storage_unavailable', 503);
  const row = result[0].results[0];
  if (!row) throw new CollectionError('forbidden', 403);
  return row;
}
async function response(row: ProjectRow, options: Options, canEdit: boolean): Promise<ProjectSettings> {
  try {
    const settings = validateMutableSettings({ name: row.name, status: row.status, allowedOrigins: JSON.parse(row.allowed_origins_json),
      limits: { requestsPerMinute: row.requests_per_minute, newReceiptsPerUtcDay: row.new_receipts_per_utc_day } }, options);
    const result = { project: { id: row.id, name: settings.name, status: settings.status, timeZone: row.time_zone },
      allowedOrigins: settings.allowedOrigins, limits: settings.limits };
    return { ...result, settingsHash: await settingsHash(result), canEdit };
  } catch { throw new CollectionError('storage_unavailable', 503); }
}
export async function projectSettings(db: SqlDatabase, principal: AdminPrincipal, id: string, options: Options): Promise<ProjectSettings> {
  const row = await read(db, principal, id, false);
  return response(row, options, row.role === 'owner');
}
export async function updateProjectSettings(db: SqlDatabase, principal: AdminPrincipal, id: string, input: ProjectSettingsUpdate, options: Options, now = Date.now()): Promise<ProjectSettings> {
  const update = parseSettingsUpdate(input);
  const before = await read(db, principal, id, true);
  const current = await response(before, options, true);
  if (current.settingsHash !== update.expectedSettingsHash) throw new CollectionError('settings_conflict', 409);
  let next;
  try {
    next = validateMutableSettings({ name: update.name ?? current.project.name, status: update.status ?? current.project.status,
      allowedOrigins: update.allowedOrigins ?? current.allowedOrigins, limits: { ...current.limits, ...update.limits } }, options);
  } catch { throw new CollectionError('invalid_request', 400); }
  const fields: AdminChangeField[] = [];
  if (next.name !== current.project.name) fields.push('name');
  if (next.status !== current.project.status) fields.push('status');
  if (JSON.stringify(next.allowedOrigins) !== JSON.stringify(current.allowedOrigins)) fields.push('allowedOrigins');
  if (next.limits.requestsPerMinute !== current.limits.requestsPerMinute) fields.push('requestsPerMinute');
  if (next.limits.newReceiptsPerUtcDay !== current.limits.newReceiptsPerUtcDay) fields.push('newReceiptsPerUtcDay');
  // Compare settings, not ingest_revision: regular ingestion advances that revision too.
  // Recheck ownership in the write itself; the last read distinguishes revoked access from a stale edit.
  const result = await db.batch<ProjectRow>([
    db.prepare(`UPDATE projects AS p SET name = ?, status = ?, allowed_origins_json = ?, requests_per_minute = ?,
      new_receipts_per_utc_day = ?, ingest_revision = ingest_revision + 1
      WHERE p.id = ? AND ${owner} AND name = ? AND status = ? AND time_zone = ? AND allowed_origins_json = ?
      AND requests_per_minute = ? AND new_receipts_per_utc_day = ? RETURNING *`)
      .bind(next.name, next.status, JSON.stringify(next.allowedOrigins), next.limits.requestsPerMinute, next.limits.newReceiptsPerUtcDay,
        id, principal.issuer, principal.subject, before.name, before.status, before.time_zone, before.allowed_origins_json,
        before.requests_per_minute, before.new_receipts_per_utc_day),
    ...(fields.length ? [adminChangeStatement(db, id, principal, { action: 'project.settings_changed', fields }, now)] : []),
    db.prepare(`SELECT p.* FROM projects p WHERE p.id = ? AND ${owner}`).bind(id, principal.issuer, principal.subject),
  ]);
  if (result.length !== (fields.length ? 3 : 2) || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!result.at(-1)!.results[0]) throw new CollectionError('forbidden', 403);
  if (result[0]!.meta.changes === 0) throw new CollectionError('settings_conflict', 409);
  if (result[0]!.meta.changes !== 1 || result[0]!.results.length !== 1) throw new CollectionError('storage_unavailable', 503);
  if (fields.length && result[1]!.meta.changes !== 1) throw new CollectionError('storage_unavailable', 503);
  return response(result[0]!.results[0]!, options, true);
}
