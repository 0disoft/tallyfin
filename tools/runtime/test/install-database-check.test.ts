import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { installation } from '../installation.ts';
import { initialize } from '../../provision/local.ts';
import { MIGRATION_NAMES } from '../../provision/migrations.ts';
import { remoteCreatorQuery } from '../../provision/remote-wrangler.ts';
import { DATABASE_SCHEMA_SQL, compareDatabaseSchema, expectedDatabaseSchema, runInstallDatabaseCheckCli } from '../install-database-check.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const response = (rows: unknown[]) => [{ success: true, results: rows }];

test('current migrations match all metadata and missing/changed/extra objects fail without exposing SQL', async () => {
  const expected = await expectedDatabaseSchema();
  assert.deepEqual(expected.migrations, [...MIGRATION_NAMES]);
  assert.equal(expected.rows.filter(row => row.type === 'table').length, 17);
  const good = await compareDatabaseSchema(expected.rows, response([...expected.rows].reverse()));
  assert.equal(good.databaseSchemaMatches, true); assert.equal(good.expectedSchemaHash, good.observedSchemaHash);
  const index = expected.rows.find(row => row.type === 'index')!;
  const missing = await compareDatabaseSchema(expected.rows, response(expected.rows.filter(row => row !== index)));
  assert.equal(missing.databaseSchemaMatches, false); assert.deepEqual(missing.missing, [{ type: index.type, name: index.name }]);
  const trigger = expected.rows.find(row => row.type === 'trigger')!;
  const changed = await compareDatabaseSchema(expected.rows, response(expected.rows.map(row => row === trigger ? { ...row, sql: row.sql.replace('BEGIN', 'BEGIN SELECT 1;') } : row)));
  assert.equal(changed.databaseSchemaMatches, false); assert.deepEqual(changed.changed, [{ type: trigger.type, name: trigger.name }]);
  const extra = await compareDatabaseSchema(expected.rows, response([...expected.rows, { type: 'table', name: 'private_metadata', tbl_name: 'private_metadata', sql: 'CREATE TABLE private_metadata(private_value TEXT)' }]));
  assert.equal(extra.unexpectedObjects, 1); assert.ok(!JSON.stringify(extra).includes('private'));
  for (const value of [null, [], [{ success: false, results: [] }], response([expected.rows[0], expected.rows[0]]),
    response([{ ...expected.rows[0], sql: null }]), response([{ ...expected.rows[0], name: 'private.invalid' }]),
    response([{ ...expected.rows[0], sql: 'x'.repeat(512 * 1024 + 1) }])])
    await assert.rejects(compareDatabaseSchema(expected.rows, value));
});

test('CLI revalidates target before one fixed read; installed Wrangler reads local D1 and preserves data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-schema-check-test-'));
  const output = join(directory, 'prepared'), state = join(directory, 'state'); await mkdir(output);
  const accountId = crypto.randomUUID().replaceAll('-', ''), databaseId = crypto.randomUUID();
  const input = { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId, workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid', OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' } },
    login: { issuer: 'https://identity.example.invalid', clientId: 'public-test-client', scope: 'openid' } };
  const plan = installation(input, root, output);
  for (const [name, value] of Object.entries({ 'installation.json': plan.manifest, 'admin.wrangler.json': plan.admin,
    'collector.wrangler.json': plan.collector, 'admin-login.json': plan.loginSettings, 'oidc-registration.json': plan.registration }))
    await writeFile(join(output, name), JSON.stringify(value));
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}',
    compatibilityDate: '2026-08-06', host: '127.0.0.1', port: 0, d1Databases: { DB: databaseId },
    d1Persist: join(state, 'v3/d1'), log: new Log(LogLevel.NONE) });
  const execute = promisify(execFile); let reads = 0, disposed = false; const scratch: string[] = [], lines: string[] = [];
  try {
    const db = await mf.getD1Database('DB'); await initialize(db, true);
    await db.prepare("INSERT INTO retention_cleanup_state(id,last_project_id,revision) VALUES(1,'',37)").run();
    await mf.dispose(); disposed = true;
    const factory: NonNullable<Parameters<typeof runInstallDatabaseCheckCli>[2]> = (projectRoot, target) => {
      assert.equal(target.databaseId, databaseId); assert.equal(target.accountId, accountId);
      return remoteCreatorQuery(projectRoot, target, async (file, args, options) => {
        assert.equal(args[args.indexOf('--command') + 1], DATABASE_SCHEMA_SQL); reads++; scratch.push(options.cwd);
        assert.equal(args.filter(arg => arg === '--remote').length, 1);
        const local = args.map(arg => arg === '--remote' ? '--local' : arg);
        local.push('--persist-to', state); return execute(file, local, options);
      });
    };
    const args = ['--remote', '--dir', output];
    const report = await runInstallDatabaseCheckCli(args, line => lines.push(line), factory);
    assert.equal(report?.databaseSchemaMatches, true); assert.equal(reads, 1);
    assert.equal(report?.operationalReadinessVerified, false); assert.equal(report?.applicationRowsRead, false);
    assert.ok(!lines[0]!.includes(databaseId) && !lines[0]!.includes(accountId));
    for (const path of scratch) await assert.rejects(readdir(path), { code: 'ENOENT' });
    const saved = await readFile(join(output, 'collector.wrangler.json'), 'utf8');
    await writeFile(join(output, 'collector.wrangler.json'), '{}');
    await assert.rejects(runInstallDatabaseCheckCli(args, () => {}, factory)); assert.equal(reads, 1);
    await writeFile(join(output, 'collector.wrangler.json'), saved);
    for (const argv of [['--dir', output], [...args, '--apply'], [...args, '--sql', 'SELECT 1'], ['--remote', '--config', 'other']])
      await assert.rejects(runInstallDatabaseCheckCli(argv, () => {}, factory));
    assert.equal(reads, 1);
    // Re-open only this test DB to verify the sentinel and a real dropped guard.
    const check = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}',
      compatibilityDate: '2026-08-06', host: '127.0.0.1', port: 0, d1Databases: { DB: databaseId },
      d1Persist: join(state, 'v3/d1'), log: new Log(LogLevel.NONE) });
    try {
      const live = await check.getD1Database('DB');
      assert.equal(await live.prepare('SELECT revision FROM retention_cleanup_state').first('revision'), 37);
      await live.prepare('DROP TRIGGER funnel_run_update').run();
    } finally { await check.dispose(); }
    const bad = await runInstallDatabaseCheckCli(args, () => {}, factory);
    assert.equal(bad?.databaseSchemaMatches, false);
    assert.deepEqual(bad?.missing, [{ type: 'trigger', name: 'funnel_run_update' }]);
  } finally {
    if (!disposed) await mf.dispose(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
