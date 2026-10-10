import { canonicalJson, CollectionError, integer, parseSchemaPublication, PROJECT_ID, schemaDefinitions, sha256 } from '@tallyfin/core';
import type { AdminPrincipal, PublishedSchema, SchemaPage, SchemaPublication } from '@tallyfin/core';
import type { SchemaRow, SqlDatabase } from './sql.ts';
import { adminChangeStatement } from './admin-changes.ts';

const grant = (roles: string) => `EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = p.id AND g.issuer = ? AND g.subject = ? AND g.role IN (${roles}))`;
interface PublishedRow extends SchemaRow { published_at: number }
function metadata(row: PublishedRow): SchemaPage['data'][number] {
  if (!integer(row.version, 1, 2147483647) || !['active', 'retired'].includes(row.status) ||
    !integer(row.published_at, 0, 8640000000000000)) throw new CollectionError('storage_unavailable', 503);
  return { schemaVersion: row.version, schemaStatus: row.status, publishedAt: new Date(row.published_at).toISOString() };
}
export async function listSchemas(db: SqlDatabase, principal: AdminPrincipal, id: string, limit: number, before: number | null): Promise<SchemaPage> {
  if (!PROJECT_ID.test(id) || !integer(limit, 1, 100) || (before !== null && !integer(before, 1, 2147483647)))
    throw new CollectionError('invalid_request', 400);
  const identity = [principal.issuer, principal.subject];
  const access = grant("'reader','owner'");
  const result = await db.batch<{ latest_version: number | null } | PublishedRow>([
    db.prepare(`SELECT (SELECT MAX(version) FROM project_schemas WHERE project_id = p.id) AS latest_version
      FROM projects p WHERE p.id = ? AND ${access}`).bind(id, ...identity),
    db.prepare(`SELECT s.version, s.status, s.published_at FROM project_schemas s JOIN projects p ON p.id = s.project_id
      WHERE p.id = ? AND ${access} AND (? IS NULL OR s.version < ?) ORDER BY s.version DESC LIMIT ?`).bind(id, ...identity, before, before, limit + 1),
  ]);
  if (result.length !== 2 || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  const project = result[0]!.results[0] as { latest_version: number | null } | undefined;
  if (!project) throw new CollectionError('forbidden', 403);
  if (project.latest_version !== null && !integer(project.latest_version, 1, 2147483647)) throw new CollectionError('storage_unavailable', 503);
  const rows = result[1]!.results as PublishedRow[];
  if (rows.length > limit + 1) throw new CollectionError('storage_unavailable', 503);
  return { projectId: id, latestVersion: project.latest_version, data: rows.slice(0, limit).map(metadata),
    page: { limit, beforeVersion: rows.length > limit ? rows[limit - 1]!.version : null } };
}
export async function publishSchema(db: SqlDatabase, principal: AdminPrincipal, id: string, version: number,
  input: SchemaPublication, now: number): Promise<PublishedSchema> {
  if (!PROJECT_ID.test(id) || !integer(version, 1, 2147483647) || !integer(now, 0, 8640000000000000))
    throw new CollectionError('invalid_request', 400);
  const parsed = parseSchemaPublication(input);
  const definitions = canonicalJson(schemaDefinitions(parsed));
  const access = grant("'owner'");
  // Conditional insert, revision update, grant check and retry read share one atomic D1 batch.
  // SQLite changes() refers to the immediately preceding INSERT, so retries do not advance the revision.
  const result = await db.batch<PublishedRow | { id: string }>([
    db.prepare(`INSERT INTO project_schemas (project_id, version, status, definitions_json, published_at, retired_at)
      SELECT p.id, ?, 'active', ?, ?, NULL FROM projects p WHERE p.id = ? AND ${access}
      AND (SELECT MAX(version) FROM project_schemas WHERE project_id = p.id) IS ?
      AND ? > COALESCE((SELECT MAX(version) FROM project_schemas WHERE project_id = p.id), 0)
      ON CONFLICT(project_id, version) DO NOTHING RETURNING *`)
      .bind(version, definitions, now, id, principal.issuer, principal.subject, parsed.expectedLatestVersion, version),
    db.prepare('UPDATE projects SET ingest_revision = ingest_revision + 1 WHERE id = ? AND changes() = 1').bind(id),
    adminChangeStatement(db, id, principal, { action: 'schema.published', schemaVersion: version }, now),
    db.prepare(`SELECT p.id FROM projects p WHERE p.id = ? AND ${access}`).bind(id, principal.issuer, principal.subject),
    db.prepare(`SELECT s.* FROM project_schemas s JOIN projects p ON p.id = s.project_id
      WHERE p.id = ? AND s.version = ? AND ${access}`).bind(id, version, principal.issuer, principal.subject),
  ]);
  if (result.length !== 5 || result.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!integer(result[0]!.meta.changes, 0, 1) || result[1]!.meta.changes !== result[0]!.meta.changes || result[2]!.meta.changes !== result[0]!.meta.changes)
    throw new CollectionError('storage_unavailable', 503);
  if (!result[3]!.results[0]) throw new CollectionError('forbidden', 403);
  const row = result[4]!.results[0] as PublishedRow | undefined;
  if (!row) throw new CollectionError('schema_conflict', 409);
  let persisted: string;
  try { persisted = canonicalJson(JSON.parse(row.definitions_json)); } catch { throw new CollectionError('storage_unavailable', 503); }
  if (persisted !== definitions) throw new CollectionError('schema_conflict', 409);
  return { projectId: id, ...metadata(row), definitionHash: await sha256(definitions) };
}
