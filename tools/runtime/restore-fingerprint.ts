import { canonicalJson, sha256 } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';

type SchemaRow = { name: string; type: string; tbl_name: string; sql: string | null };
export interface RestoreFingerprint { schemaHash: string; tables: { name: string; rows: number; hash: string }[]; fingerprint: string }
function normalizeSql(sql: string) {
  // Collapse formatting only outside SQL string/identifier quotes; quoted whitespace changes meaning.
  return sql.trim().replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|\s+/g, token => token.trim() ? token : ' ');
}

/** Quiesced synthetic databases only. Fingerprints include every application table, index and trigger. */
export async function restoreFingerprint(db: SqlDatabase): Promise<RestoreFingerprint> {
  const schema = await db.batch<SchemaRow>([db.prepare("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE substr(name,1,7)!='sqlite_' AND substr(name,1,4)!='_cf_' ORDER BY type,name")]);
  if (schema.length !== 1 || !schema[0]?.success) throw Error('schema_read_failed');
  const entries = schema[0].results;
  if (!entries.length || entries.some(row => !/^[a-z][a-z0-9_]*$/.test(row.name))) throw Error('unexpected_schema');
  const tables = [];
  for (const table of entries.filter(row => row.type === 'table')) {
    const result = await db.batch([db.prepare(`SELECT * FROM "${table.name}"`)]);
    if (result.length !== 1 || !result[0]?.success) throw Error('table_read_failed');
    const rows = result[0].results.map(row => canonicalJson(row)).sort();
    tables.push({ name: table.name, rows: rows.length, hash: await sha256(canonicalJson(rows)) });
  }
  const schemaHash = await sha256(canonicalJson(entries.map(row => ({ ...row, sql: row.sql === null ? null : normalizeSql(row.sql) }))));
  const fingerprint = await sha256(canonicalJson({ schemaHash, tables }));
  return { schemaHash, tables, fingerprint };
}
export async function restoreIntegrity(db: SqlDatabase) {
  const result = await db.batch([db.prepare('PRAGMA foreign_key_check'), db.prepare('PRAGMA quick_check')]);
  if (result.length !== 2 || result.some(row => !row.success) || result[0]!.results.length ||
    result[1]!.results.length !== 1 || Object.keys(result[1]!.results[0]!).length !== 1 || result[1]!.results[0]!.quick_check !== 'ok') throw Error('integrity_failed');
}
