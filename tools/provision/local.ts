import { resolve } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { ProvisionError } from './input.ts';
import { loadMigrations } from './migrations.ts';

export async function openLocal(stateDir: string) {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null, {status:404}); } }',
    compatibilityDate: '2026-08-06', host: '127.0.0.1', d1Databases: { DB: 'tallyfin-local' },
    d1Persist: resolve(stateDir), log: new Log(LogLevel.NONE) });
  try { return { db: await mf.getD1Database('DB'), close: () => mf.dispose() }; }
  catch { await mf.dispose(); throw new ProvisionError('database_unavailable', '로컬 D1을 열지 못했어요.'); }
}

export async function initialize(db: SqlDatabase, apply: boolean): Promise<{ migrations: string[]; applied: boolean }> {
  const migrations: { name: string; statements: string[]; tables: string[]; columns: { table: string; name: string }[] }[] = [];
  for (const { name, sql: source, statements } of loadMigrations()) {
    const sql = source.replace(/^--.*$/gm, '');
    // Rebuilt tables already existed; only the stable publisher table marks migration 0006.
    const tables = name === '0006_server_collection.sql' ? ['project_publishers'] : ['0008_publisher_history.sql', '0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql'].includes(name) ? [] :
      [...sql.matchAll(/CREATE TABLE ([a-z_]+)/g)].map(match => match[1]!);
    const columns = [...sql.matchAll(/ALTER TABLE ([a-z_]+) ADD COLUMN ([a-z_]+)/g)].map(match => ({ table: match[1]!, name: match[2]! }));
    migrations.push({ name, statements, tables, columns });
  }
  const result = await db.batch<{ name: string; sql: string }>([db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'")]);
  if (!result[0]?.success) throw Error();
  const existing = new Set(result[0].results.map(row => row.name));
  const publisherSql = result[0].results.find(row => row.name === 'project_publishers')?.sql ?? '';
  const generations = /\bgrant_id\b/i.test(publisherSql);
  if (existing.has('project_publishers_next'))
    throw new ProvisionError('partial_database', '불완전한 발행 권한 DB라 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  if (generations) {
    const guards = await db.batch<{ name: string; sql: string }>([
      db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='project_publishers'")]);
    const immutable = guards[0]?.results.find(row => row.name === 'immutable_publisher_generation')?.sql ?? '';
    if (!guards[0]?.success || !/BEFORE UPDATE ON project_publishers/i.test(immutable) ||
      !immutable.includes("RAISE(ABORT, 'publisher_generation_immutable')") ||
      !/grant_id TEXT NOT NULL DEFAULT \(lower\(hex\(randomblob\(16\)\)\)\)/i.test(publisherSql) ||
      !publisherSql.includes("CHECK (length(grant_id) = 32 AND grant_id NOT GLOB '*[^0-9a-f]*')") ||
      !/UNIQUE\s*\(grant_id\)/i.test(publisherSql))
      throw new ProvisionError('partial_database', '발행 권한 DB의 부여 ID 제약이 빠져 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  }
  const historySql = result[0].results.find(row => row.name === 'admin_changes')?.sql ?? '';
  const expandedHistory = historySql.includes("'publisher.granted'") && historySql.includes("'publisher.revoked'");
  if (existing.has('admin_changes_next') || historySql.includes("'publisher.granted'") !== historySql.includes("'publisher.revoked'"))
    throw new ProvisionError('partial_database', '불완전한 발행자 이력 DB라 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  if (expandedHistory) {
    const guards = await db.batch<{ name: string }>([db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','index') AND tbl_name='admin_changes'")]);
    if (!guards[0]?.success || ['admin_changes_project_time', 'validate_admin_change_fields', 'immutable_admin_change'].some(name =>
      !guards[0]!.results.some(row => row.name === name)))
      throw new ProvisionError('partial_database', '발행자 이력 DB의 제약·인덱스가 빠져 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  }
  const serverSources = /CHECK\s*\(\s*source\s+IN\s*\(\s*'browser'\s*,\s*'server'\s*\)\s*\)/i;
  const extended = result[0].results.filter(row => ['event_receipts', 'event_daily_counts'].includes(row.name) && serverSources.test(row.sql)).length;
  if (existing.has('event_receipts_next') || existing.has('event_daily_counts_next') ||
    (existing.has('project_publishers') ? extended !== 2 : extended !== 0))
    throw new ProvisionError('partial_database', '불완전한 서버 수집 DB라 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  if (existing.has('funnel_runs') && existing.has('funnel_daily_counts')) {
    const guards = await db.batch<{ name: string }>([db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','index') AND tbl_name IN ('funnel_runs','funnel_daily_counts')")]);
    const required = ['funnel_run_insert', 'funnel_run_update', 'funnel_daily_insert', 'funnel_daily_update', 'funnel_runs_expiry', 'funnel_daily_retention'];
    if (!guards[0]?.success || required.some(name => !guards[0]!.results.some(row => row.name === name)))
      throw new ProvisionError('partial_database', '퍼널 DB의 제약·인덱스가 빠져 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  }
  const existingColumns = new Set<string>();
  for (const table of new Set(migrations.flatMap(migration => migration.columns.map(column => column.table)))) {
    if (!existing.has(table)) continue;
    const columns = await db.batch<{ name: string }>([db.prepare(`PRAGMA table_info(${table})`)]);
    if (!columns[0]?.success) throw Error();
    for (const column of columns[0].results) existingColumns.add(`${table}.${column.name}`);
  }
  if (existingColumns.has('projects.grant_revision')) {
    const guards = await db.batch<{ name: string; sql: string }>([db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='project_grants'")]);
    const required = ['grant_revision_insert', 'grant_revision_update', 'grant_revision_delete'];
    if (!guards[0]?.success || required.some(name => !guards[0]!.results.some(row => row.name === name && row.sql.includes('grant_revision = grant_revision + 1'))))
      throw new ProvisionError('partial_database', '권한 revision 트리거가 빠져 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  }
  if (existingColumns.has('workflow_daily_counts.duration_counts_json')) {
    const sql = result[0].results.find(row => row.name === 'workflow_daily_counts')?.sql ?? '';
    if (!sql.includes('json_array_length(duration_counts_json) = 12') ||
      Array.from({ length: 12 }, (_, i) => `json_type(duration_counts_json, '$[${i}]') = 'integer'`).some(check => !sql.includes(check)) ||
      !sql.includes('<= succeeded_count') || !sql.includes('<= failed_count'))
      throw new ProvisionError('partial_database', '소요시간 집계 제약이 빠져 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  }
  if (existingColumns.has('workflow_daily_counts.failure_reason_counts_json')) {
    const sql = result[0].results.find(row => row.name === 'workflow_daily_counts')?.sql ?? '';
    const attempts = result[0].results.find(row => row.name === 'workflow_attempts')?.sql ?? '';
    if (!sql.includes('json_array_length(failure_reason_counts_json) = 33') ||
      !sql.includes('<= failed_count') || !attempts.includes("terminal_kind IS 'failure'") ||
      Array.from({ length: 33 }, (_, i) => `json_type(failure_reason_counts_json, '$[${i}]') = 'integer'`).some(check => !sql.includes(check)))
      throw new ProvisionError('partial_database', '실패 원인 집계 제약이 빠져 초기화를 중단했어요. DB 상태를 확인해 주세요.');
  }
  // Index-only upgrades need their own marker; tables and columns cannot detect them.
  const lookup = migrations.find(migration => migration.name === '0011_analytics_lookup.sql')!;
  const indexNames = ['event_daily_counts_lookup', 'funnel_daily_counts_lookup'];
  const indexes = await db.batch<{ name: string; sql: string }>([
    db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('event_daily_counts_lookup','funnel_daily_counts_lookup')")]);
  if (!indexes[0]?.success) throw Error();
  const normalizeIndex = (sql: string) => sql.replace(/[\s;]/g, '').toLowerCase();
  const present = indexes[0].results;
  if (present.length && (present.length !== indexNames.length || indexNames.some((name, index) =>
    !present.some(row => row.name === name && normalizeIndex(row.sql) === normalizeIndex(lookup.statements[index]!)))))
    throw new ProvisionError('partial_database', 'Analytics lookup indexes are incomplete or changed. Check the database schema.');
  const missing = migrations.filter(migration => {
    if (migration === lookup) return present.length === 0;
    if (migration.name === '0008_publisher_history.sql') return !expandedHistory;
    if (migration.name === '0009_publisher_generations.sql') return !generations;
    const count = migration.tables.filter(table => existing.has(table)).length + migration.columns.filter(column => existingColumns.has(`${column.table}.${column.name}`)).length;
    if (count && count !== migration.tables.length + migration.columns.length) throw new ProvisionError('partial_database', '불완전한 DB라 초기화를 중단했어요. DB 상태를 확인해 주세요.');
    return count === 0;
  });
  if (apply && missing.length) {
    const statements = missing.flatMap(migration => migration.statements.map(sql => db.prepare(sql)));
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(row => !row.success)) throw Error();
  }
  return { migrations: missing.map(migration => migration.name), applied: apply && missing.length > 0 };
}
