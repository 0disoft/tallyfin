import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { ProvisionError } from './input.ts';

export async function openLocal(stateDir: string) {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null, {status:404}); } }',
    compatibilityDate: '2026-08-06', host: '127.0.0.1', d1Databases: { DB: 'tallyfin-local' },
    d1Persist: resolve(stateDir), log: new Log(LogLevel.NONE) });
  try { return { db: await mf.getD1Database('DB'), close: () => mf.dispose() }; }
  catch { await mf.dispose(); throw new ProvisionError('database_unavailable', '로컬 D1을 열지 못했어요.'); }
}

export async function initialize(db: SqlDatabase, apply: boolean): Promise<{ migrations: string[]; applied: boolean }> {
  const migrations: { name: string; statements: string[]; tables: string[] }[] = [];
  for (const name of ['0001_initial.sql', '0002_retention_cleanup.sql', '0003_project_creation.sql']) {
    const sql = (await readFile(new URL(`../../db/migrations/${name}`, import.meta.url), 'utf8')).replace(/^--.*$/gm, '');
    // Repository-owned migrations have no quoted semicolons; keep complete trigger bodies.
    const statements = [...sql.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(match => match[1]!.trim());
    const tables = [...sql.matchAll(/CREATE TABLE ([a-z_]+)/g)].map(match => match[1]!);
    migrations.push({ name, statements, tables });
  }
  const result = await db.batch<{ name: string }>([db.prepare("SELECT name FROM sqlite_master WHERE type='table'")]);
  if (!result[0]?.success) throw Error();
  const existing = new Set(result[0].results.map(row => row.name));
  const missing = migrations.filter(migration => {
    const count = migration.tables.filter(table => existing.has(table)).length;
    if (count && count !== migration.tables.length) throw new ProvisionError('partial_database', '불완전한 DB라 초기화를 중단했어요. DB 상태를 확인해 주세요.');
    return count === 0;
  });
  if (apply && missing.length) {
    const statements = missing.flatMap(migration => migration.statements.map(sql => db.prepare(sql)));
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(row => !row.success)) throw Error();
  }
  return { migrations: missing.map(migration => migration.name), applied: apply && missing.length > 0 };
}
