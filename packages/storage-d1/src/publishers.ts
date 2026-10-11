import { CollectionError, integer, PROJECT_ID, validGrantIdentity } from '@tallyfin/core';
import type { AdminPrincipal, ProjectPublisher, ProjectPublisherPage } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';

const owner = "EXISTS (SELECT 1 FROM project_grants a WHERE a.project_id = p.id AND a.issuer = ? AND a.subject = ? AND a.role = 'owner')";
interface PublisherRow { issuer: string; subject: string; created_at: number }
function encode(id: string, issuer: string, subject: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(['publishers', 1, id, issuer, subject]));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(id: string, cursor: string): [string, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 12288 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
    if (!Array.isArray(value) || value.length !== 5 || value[0] !== 'publishers' || value[1] !== 1 || value[2] !== id ||
      !validGrantIdentity(value[3], value[4]) || encode(id, value[3], value[4]) !== cursor) throw Error();
    return [value[3], value[4]];
  } catch { throw new CollectionError('invalid_request', 400); }
}
function metadata(row: PublisherRow): ProjectPublisher {
  if (!validGrantIdentity(row.issuer, row.subject) || !integer(row.created_at, 0, 8640000000000000))
    throw new CollectionError('storage_unavailable', 503);
  return { issuer: row.issuer, subject: row.subject, createdAt: new Date(row.created_at).toISOString() };
}
/** Publishing permission never grants access to this administrator control-plane list. */
export async function listProjectPublishers(db: SqlDatabase, principal: AdminPrincipal, id: string, limit: number,
  cursor: string): Promise<ProjectPublisherPage> {
  if (!PROJECT_ID.test(id) || !integer(limit, 1, 100)) throw new CollectionError('invalid_request', 400);
  const after = decode(id, cursor), caller = [principal.issuer, principal.subject];
  // Both statements share a transaction and enforce the current project owner independently.
  const result = await db.batch<{ id: string } | PublisherRow>([
    db.prepare(`SELECT p.id FROM projects p WHERE p.id = ? AND ${owner}`).bind(id, ...caller),
    db.prepare(`SELECT g.issuer, g.subject, g.created_at FROM project_publishers g JOIN projects p ON p.id = g.project_id
      WHERE p.id = ? AND ${owner} ${after ? 'AND (g.issuer, g.subject) > (?, ?)' : ''}
      ORDER BY g.issuer, g.subject LIMIT ?`).bind(id, ...caller, ...(after ?? []), limit + 1),
  ]);
  if (result.length !== 2 || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!result[0]!.results.length) throw new CollectionError('forbidden', 403);
  const rows = result[1]!.results as PublisherRow[];
  if (rows.length > limit + 1) throw new CollectionError('storage_unavailable', 503);
  const data = rows.map(metadata), last = data[limit - 1];
  return { projectId: id, data: data.slice(0, limit), page: { limit,
    nextCursor: rows.length > limit && last ? encode(id, last.issuer, last.subject) : null } };
}
