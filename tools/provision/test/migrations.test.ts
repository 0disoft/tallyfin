import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { MIGRATION_NAMES, assertMigrationCatalog, loadMigrations, splitMigrationStatements } from '../migrations.ts';

test('reviewed catalog covers every SQL source in order and refuses missing, extra or duplicated migrations', () => {
  const files = readdirSync(new URL('../../../db/migrations/', import.meta.url));
  assertMigrationCatalog(files.reverse());
  assert.equal(Object.isFrozen(MIGRATION_NAMES), true);
  for (const names of [MIGRATION_NAMES.slice(1), [...MIGRATION_NAMES, '0014_future.sql'],
    [...MIGRATION_NAMES, MIGRATION_NAMES[0]], [...MIGRATION_NAMES.slice(0, -1), '0013_typo.sql']])
    assert.throws(() => assertMigrationCatalog(names), /migration catalog/);
  const migrations = loadMigrations();
  assert.deepEqual(migrations.map(migration => migration.name), [...MIGRATION_NAMES]);
  assert.ok(migrations.every(migration => migration.sql.length && migration.statements.length));
  migrations[0]!.statements.length = 0;
  assert.ok(loadMigrations()[0]!.statements.length); // Caller-local arrays cannot corrupt later initialization.
});

test('shared SQL splitting keeps complete multi-statement trigger bodies and ignores full-line comments', () => {
  const trigger = "CREATE TRIGGER sample BEFORE UPDATE ON projects BEGIN SELECT 1; SELECT RAISE(ABORT, 'blocked'); END;";
  assert.deepEqual(splitMigrationStatements(`-- comment\nCREATE TABLE sample(id INTEGER);\n${trigger}\n-- end\nSELECT 2;`),
    ['CREATE TABLE sample(id INTEGER);', trigger, 'SELECT 2;']);
});
