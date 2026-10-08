// Narrow structural port consumed by this adapter. Actual Workers D1 types remain at the host boundary.
export type SqlValue = string | number | null;
export interface SqlStatement { bind(...values: SqlValue[]): SqlStatement }
export interface SqlResult<T> { success: boolean; results: T[]; meta: { changes: number } }
export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}
export interface ProjectRow {
  id: string; name: string; status: 'active' | 'paused'; time_zone: string; allowed_origins_json: string;
  requests_per_minute: number; new_receipts_per_utc_day: number; ingest_revision: number;
}
export interface SchemaRow { version: number; status: 'active' | 'retired'; definitions_json: string }

export function bulk(db: SqlDatabase, table: string, columns: string[], rows: SqlValue[][], suffix: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  // D1 permits at most 100 bound parameters per query. Names/suffix come only from source constants.
  const size = Math.floor(100 / columns.length);
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = rows.slice(offset, offset + size);
    statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',')} ${suffix}`).bind(...chunk.flat()));
  }
  return statements;
}
