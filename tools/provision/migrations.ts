import { readFileSync, readdirSync } from 'node:fs';

/** Ordered, reviewed upgrades. Register new SQL before initialization can inspect or modify a database. */
export const MIGRATION_NAMES = Object.freeze([
  '0001_initial.sql', '0002_retention_cleanup.sql', '0003_project_creation.sql',
  '0004_collection_rejections.sql', '0005_admin_changes.sql', '0006_server_collection.sql',
  '0007_task_funnels.sql', '0008_publisher_history.sql', '0009_publisher_generations.sql',
  '0010_grant_revision.sql', '0011_analytics_lookup.sql', '0012_workflow_duration.sql',
  '0013_workflow_failure_reasons.sql',
] as const);

export function assertMigrationCatalog(files: readonly string[]): void {
  const actual = files.filter(name => name.endsWith('.sql')).sort();
  if (actual.length !== MIGRATION_NAMES.length || actual.some((name, index) => name !== MIGRATION_NAMES[index]))
    throw Error('Repository SQL files differ from the reviewed migration catalog.');
}

/** Repository SQL uses full-line comments and no quoted semicolons; preserve whole trigger bodies. */
export function splitMigrationStatements(sql: string): string[] {
  return [...sql.replace(/^--.*$/gm, '').matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)]
    .map(match => match[1]!.trim());
}

export function loadMigrations() {
  const directory = new URL('../../db/migrations/', import.meta.url);
  assertMigrationCatalog(readdirSync(directory));
  return MIGRATION_NAMES.map(name => {
    const sql = readFileSync(new URL(name, directory), 'utf8');
    return { name, sql, statements: splitMigrationStatements(sql) };
  });
}
