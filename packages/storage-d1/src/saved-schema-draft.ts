import { CollectionError, DRAFT_REVISION, integer, parseSaveSchemaDraft, PROJECT_ID } from '@tallyfin/core';
import type { AdminPrincipal, SaveSchemaDraft, SchemaDraftSnapshot } from '@tallyfin/core';
import type { SqlDatabase } from './sql.ts';

type DraftRow = { revision: string; payload_json: string; updated_at: number };
const owner = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id=p.id AND g.issuer=? AND g.subject=? AND g.role='owner')";
function snapshot(id: string, row: DraftRow | undefined): SchemaDraftSnapshot {
  if (!row) return { projectId: id, draft: null };
  try {
    if (!DRAFT_REVISION.test(row.revision) || !integer(row.updated_at, 0, 8640000000000000)) throw Error();
    const payload = parseSaveSchemaDraft({ ...JSON.parse(row.payload_json), expectedRevision: row.revision }, id);
    return { projectId: id, draft: { revision: row.revision, targetVersion: payload.targetVersion, draftText: payload.draftText,
      updatedAt: new Date(row.updated_at).toISOString() } };
  } catch (cause) { throw new CollectionError('storage_unavailable', 503, { cause }); }
}
const statements = (db: SqlDatabase, principal: AdminPrincipal, id: string) => [
  db.prepare(`SELECT p.id FROM projects p WHERE p.id=? AND ${owner}`).bind(id, principal.issuer, principal.subject),
  db.prepare(`SELECT d.* FROM project_schema_drafts d JOIN projects p ON p.id=d.project_id WHERE p.id=? AND ${owner}`)
    .bind(id, principal.issuer, principal.subject),
];
export async function schemaDraft(db: SqlDatabase, principal: AdminPrincipal, id: string): Promise<SchemaDraftSnapshot> {
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  const rows = await db.batch<DraftRow | { id: string }>(statements(db, principal, id));
  if (rows.length !== 2 || rows.some(r => !r.success || !Array.isArray(r.results))) throw new CollectionError('storage_unavailable', 503);
  if (!rows[0]!.results[0]) throw new CollectionError('forbidden', 403);
  return snapshot(id, rows[1]!.results[0] as DraftRow | undefined);
}
export async function saveSchemaDraft(db: SqlDatabase, principal: AdminPrincipal, id: string, input: SaveSchemaDraft,
  now: number, newRevision = () => crypto.randomUUID().replaceAll('-', '')): Promise<SchemaDraftSnapshot> {
  const value = parseSaveSchemaDraft(input, id), revision = newRevision();
  if (!integer(now, 0, 8640000000000000) || !DRAFT_REVISION.test(revision)) throw new CollectionError('invalid_request', 400);
  const payload = JSON.stringify({ targetVersion: value.targetVersion, draftText: value.draftText });
  // Grant check and CAS execute inside the write transaction. Missing + stale is never a new insert.
  const rows = await db.batch<DraftRow | { id: string }>([
    db.prepare(`INSERT INTO project_schema_drafts (project_id,revision,payload_json,updated_at)
      SELECT p.id,?,?,? FROM projects p WHERE p.id=? AND ${owner}
      AND (? IS NULL OR EXISTS (SELECT 1 FROM project_schema_drafts d WHERE d.project_id=p.id AND d.revision=?))
      ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,updated_at=excluded.updated_at
      WHERE project_schema_drafts.revision=? RETURNING *`)
      .bind(revision, payload, now, id, principal.issuer, principal.subject, value.expectedRevision, value.expectedRevision, value.expectedRevision),
    ...statements(db, principal, id),
  ]);
  if (rows.length !== 3 || rows.some(r => !r.success || !Array.isArray(r.results)) || !integer(rows[0]!.meta.changes, 0, 1))
    throw new CollectionError('storage_unavailable', 503);
  if (!rows[1]!.results[0]) throw new CollectionError('forbidden', 403);
  if (rows[0]!.meta.changes !== 1) throw new CollectionError('schema_draft_conflict', 409);
  return snapshot(id, rows[2]!.results[0] as DraftRow | undefined);
}
