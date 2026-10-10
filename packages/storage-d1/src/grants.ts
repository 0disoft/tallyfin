import { CollectionError, integer, PROJECT_ID } from '@tallyfin/core';
import type { AdminPrincipal, ProjectGrant, ProjectGrantPage } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants a WHERE a.project_id = p.id AND a.issuer = ? AND a.subject = ? AND a.role = 'owner')";
interface GrantRow { issuer: string; subject: string; role: 'reader' | 'owner'; created_at: number }
function identity(issuer: unknown, subject: unknown): issuer is string {
  if (typeof issuer !== 'string' || !issuer.length || issuer.length > 512 || issuer !== issuer.trim() || typeof subject !== 'string' ||
    !subject.trim() || subject.length > 512 || /[\x00-\x1f\x7f]/.test(subject)) return false;
  try {
    const url = new URL(issuer);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function encode(id: string, issuer: string, subject: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify([1, id, issuer, subject]));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(id: string, cursor: string): [string, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 12288 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== id ||
      !identity(value[2], value[3]) || encode(id, value[2], value[3]) !== cursor) throw Error();
    return [value[2], value[3]];
  } catch { throw new CollectionError('invalid_request', 400); }
}
function metadata(row: GrantRow): ProjectGrant {
  if (!identity(row.issuer, row.subject) || !['reader', 'owner'].includes(row.role) ||
    !integer(row.created_at, 0, 8640000000000000)) throw new CollectionError('storage_unavailable', 503);
  return { issuer: row.issuer, subject: row.subject, role: row.role, createdAt: new Date(row.created_at).toISOString() };
}
export async function listProjectGrants(db: SqlDatabase, principal: AdminPrincipal, id: string, limit: number,
  cursor: string): Promise<ProjectGrantPage> {
  if (!PROJECT_ID.test(id) || !integer(limit, 1, 100)) throw new CollectionError('invalid_request', 400);
  const after = decode(id, cursor);
  const caller = [principal.issuer, principal.subject];
  // Permission and rows share one transactional snapshot. The cursor is only a position, never authority.
  const result = await db.batch<{ id: string } | GrantRow>([
    db.prepare(`SELECT p.id FROM projects p WHERE p.id = ? AND ${owner}`).bind(id, ...caller),
    db.prepare(`SELECT g.issuer, g.subject, g.role, g.created_at FROM project_grants g JOIN projects p ON p.id = g.project_id
      WHERE p.id = ? AND ${owner} ${after ? 'AND (g.issuer, g.subject) > (?, ?)' : ''}
      ORDER BY g.issuer, g.subject LIMIT ?`).bind(id, ...caller, ...(after ?? []), limit + 1),
  ]);
  if (result.length !== 2 || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!result[0]!.results.length) throw new CollectionError('forbidden', 403);
  const rows = result[1]!.results as GrantRow[];
  if (rows.length > limit + 1) throw new CollectionError('storage_unavailable', 503);
  const data = rows.map(metadata);
  const last = data[limit - 1];
  return { projectId: id, data: data.slice(0, limit), page: { limit,
    nextCursor: rows.length > limit && last ? encode(id, last.issuer, last.subject) : null } };
}
