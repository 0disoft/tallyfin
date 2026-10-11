import { fileURLToPath, pathToFileURL } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { canonicalJson, closed, sha256 } from '@tallyfin/core';
import { initialize } from '../provision/local.ts';
import { remoteCreatorQuery } from '../provision/remote-wrangler.ts';
import type { CreatorQuery, RemoteCreatorTarget } from '../provision/remote-creators.ts';
import { preparedInstallation } from './prepared-installation.ts';
import { normalizeSql } from './restore-fingerprint.ts';

// One fixed metadata SELECT. Never reads product records, identities or migration ledger rows.
export const DATABASE_SCHEMA_SQL = "SELECT name,type,tbl_name,sql FROM sqlite_master WHERE substr(name,1,7)!='sqlite_' AND substr(name,1,4)!='_cf_' AND name!='d1_migrations' ORDER BY type,name";
type SchemaRow = { name: string; type: string; tbl_name: string; sql: string };
export const DATABASE_CHECK_HELP = `Tallyfin installation: read-only remote database schema check
npm run install:database-check -- --remote --dir <prepared-installation>
Revalidates installation files and compares metadata with all repository migrations.
Uses existing Wrangler authentication. No login, application rows, migration, grants or deployment.
Schema equality does not prove runtime, data integrity, backups or operational readiness.`;

function schemaRows(value: unknown): SchemaRow[] {
  if (!Array.isArray(value) || value.length !== 1 || value[0]?.success !== true ||
    !Array.isArray(value[0].results) || value[0].results.length > 256) throw Error('Invalid schema response');
  const rows: SchemaRow[] = []; const keys = new Set<string>(); let bytes = 0;
  for (const row of value[0].results) {
    if (!closed(row, ['name', 'type', 'tbl_name', 'sql']) ||
      typeof row.name !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(row.name) ||
      typeof row.tbl_name !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(row.tbl_name) ||
      typeof row.type !== 'string' || !['table', 'index', 'trigger', 'view'].includes(row.type) || typeof row.sql !== 'string') throw Error('Invalid schema row');
    bytes += Buffer.byteLength(row.sql); if (bytes > 512 * 1024) throw Error('Schema too large');
    const key = `${row.type}:${row.name}`; if (keys.has(key)) throw Error('Duplicate schema row'); keys.add(key);
    rows.push({ name: row.name, type: String(row.type), tbl_name: row.tbl_name, sql: normalizeSql(row.sql) });
  }
  return rows.sort((a, b) => `${a.type}:${a.name}` < `${b.type}:${b.name}` ? -1 : 1);
}

/** New in-memory local database only; no existing local or remote data is initialized. */
export async function expectedDatabaseSchema() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate: '2026-08-06', host: '127.0.0.1', port: 0,
    d1Databases: { DB: crypto.randomUUID() }, log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB'); const applied = await initialize(db, true);
    const rows = schemaRows(await db.batch([db.prepare(DATABASE_SCHEMA_SQL)]));
    if (!rows.length) throw Error('Empty reference schema');
    return { rows, migrations: applied.migrations };
  } finally { await mf.dispose(); }
}

export async function compareDatabaseSchema(expected: SchemaRow[], response: unknown) {
  const observed = schemaRows(response); const wanted = new Map(expected.map(row => [`${row.type}:${row.name}`, row]));
  const actual = new Map(observed.map(row => [`${row.type}:${row.name}`, row]));
  const missing: { type: string; name: string }[] = [], changed: { type: string; name: string }[] = [];
  for (const [key, row] of wanted) {
    const found = actual.get(key);
    if (!found) missing.push({ type: row.type, name: row.name });
    else if (canonicalJson(found) !== canonicalJson(row)) changed.push({ type: row.type, name: row.name });
  }
  // Unexpected object names and SQL might contain sensitive provider-owned metadata; report only their count.
  const unexpectedObjects = observed.filter(row => !wanted.has(`${row.type}:${row.name}`)).length;
  return { databaseSchemaMatches: !missing.length && !changed.length && !unexpectedObjects,
    expectedObjects: expected.length, observedObjects: observed.length, missing, changed, unexpectedObjects,
    expectedSchemaHash: await sha256(canonicalJson(expected)), observedSchemaHash: await sha256(canonicalJson(observed)) };
}

type QueryFactory = (root: string, target: RemoteCreatorTarget) => CreatorQuery;
export async function runInstallDatabaseCheckCli(argv: string[], write = (line: string) => process.stdout.write(`${line}\n`),
  queryFactory: QueryFactory = remoteCreatorQuery) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { write(DATABASE_CHECK_HELP); return; }
  if (argv.length !== 3 || argv[0] !== '--remote' || argv[1] !== '--dir' || !argv[2] || argv[2].startsWith('--'))
    throw Error('Use --remote --dir <prepared-installation>');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  // Validate every file before constructing a transport or touching the network.
  const plan = await preparedInstallation(argv[2], root); const collector = plan.collector;
  const database = collector.d1_databases[0]!;
  const target = { accountId: collector.account_id, workerName: collector.name,
    databaseName: database.database_name, databaseId: database.database_id, issuer: collector.vars.OIDC_ISSUER };
  const reference = await expectedDatabaseSchema();
  const response = await queryFactory(root, target)(DATABASE_SCHEMA_SQL);
  const result = await compareDatabaseSchema(reference.rows, response);
  const report = { schemaVersion: 'tallyfin.installation-database-check/v1', remote: true, remoteChanges: false,
    applicationRowsRead: false, operationalReadinessVerified: false,
    targetHash: await sha256(canonicalJson({ accountId: target.accountId, databaseId: target.databaseId, workerName: target.workerName })),
    referenceMigrations: reference.migrations, ...result };
  write(JSON.stringify(report)); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInstallDatabaseCheckCli(process.argv.slice(2)).then(report => {
    if (report && !report.databaseSchemaMatches) process.exitCode = 1;
  }).catch(() => {
    process.stderr.write('Installation database check failed. Check arguments, unchanged installation files and database access.\n');
    process.exitCode = 1;
  });
}
