import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { D1Store } from '@tallyfin/storage-d1';
import { parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, sha256 } from '@tallyfin/core';
import { seedRestoreFixture, DRILL_TIME } from './restore-fixture.ts';
import { restoreFingerprint, restoreIntegrity } from './restore-fingerprint.ts';
import { verifyRestoredPublishers } from './restore-publishers.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
function localDatabase(directory: string, id: string) {
  return new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate: '2026-08-06', host: '127.0.0.1', port: 0, d1Databases: { DB: id },
    d1Persist: join(directory, '.wrangler/state/v3/d1'), log: new Log(LogLevel.NONE) });
}
async function localConfig(directory: string, id: string) {
  await mkdir(directory);
  const config = join(directory, 'wrangler.json'), envFile = join(directory, 'empty.env');
  await writeFile(config, JSON.stringify({ name: 'tallyfin-restore-drill', send_metrics: false,
    d1_databases: [{ binding: 'DB', database_name: 'restore-drill', database_id: id }] }), { flag: 'wx' });
  await writeFile(envFile, '', { flag: 'wx' });
  return { directory, config, envFile, id };
}
async function wrangler(config: Awaited<ReturnType<typeof localConfig>>, command: string[], signal: AbortSignal) {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_WRITE_LOGS: 'false' };
  for (const key of ['NODE_OPTIONS', 'WRANGLER_OUTPUT_FILE_PATH', 'WRANGLER_OUTPUT_FILE_DIRECTORY', 'CLOUDFLARE_ENV', 'WRANGLER_ENV',
    'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID']) delete env[key];
  await execute(process.execPath, ['--no-warnings', resolve(root, 'node_modules/wrangler/wrangler-dist/cli.js'),
    'd1', ...command, '--local', '--config', config.config, '--env-file', config.envFile],
  { cwd: config.directory, env, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 30000, signal });
}
export async function runRestoreDrill(signal: AbortSignal = new AbortController().signal) {
  const outputRoot = resolve(root, '.tmp/restore-drill'); await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(join(outputRoot, 'run-'));
  const started = performance.now(); let phase = 'initialize';
  let source: Miniflare | undefined, restored: Miniflare | undefined;
  try {
    if (signal.aborted) throw Error();
    const from = await localConfig(join(output, 'source'), crypto.randomUUID());
    const to = await localConfig(join(output, 'restored'), crypto.randomUUID());
    source = localDatabase(from.directory, from.id); const db = await source.getD1Database('DB');
    const fixture = await seedRestoreFixture(db);
    await restoreIntegrity(db); const before = await restoreFingerprint(db);
    if (before.tables.length !== 16 || before.tables.some(table => table.rows === 0)) throw Error('fixture_coverage_failed');
    await source.dispose(); source = undefined;
    phase = 'export'; const backup = join(output, 'backup.sql');
    const exportStart = performance.now(); await wrangler(from, ['export', 'DB', '--output', backup], signal);
    const exportMs = performance.now() - exportStart;
    const bytes = await readFile(backup); if (!bytes.length) throw Error('empty_export');
    phase = 'restore'; const restoreStart = performance.now();
    await wrangler(to, ['execute', 'DB', '--file', backup], signal);
    const restoreMs = performance.now() - restoreStart;
    phase = 'verify'; restored = localDatabase(to.directory, to.id); const recovered = await restored.getD1Database('DB');
    await restoreIntegrity(recovered); const after = await restoreFingerprint(recovered);
    if (before.fingerprint !== after.fingerprint) {
      await writeFile(join(output, 'mismatch.json'), JSON.stringify({ before, after }, null, 2), { flag: 'wx' });
      throw Error('restore_mismatch');
    }
    // A restored receipt/run must suppress replay rather than double-counting either source.
    const store = new D1Store(recovered);
    const browser = await store.commit(await prepareBatch(parseBatch(JSON.stringify(fixture.workflowInput)), fixture.browser, DRILL_TIME), fixture.browser);
    const last = fixture.funnelInputs[3]!;
    const server = await store.commitServer(await prepareServerBatch(parseServerBatch(JSON.stringify(last)), fixture.funnel, DRILL_TIME), fixture.funnel, fixture.principal);
    if (browser.accepted !== 0 || browser.duplicates !== 2 || server.accepted !== 0 || server.duplicates !== 1 ||
      (await restoreFingerprint(recovered)).fingerprint !== after.fingerprint) throw Error('replay_changed_restored_data');
    const protectedWrites = [
      'UPDATE project_schemas SET definitions_json=definitions_json',
      'UPDATE project_creations SET request_hash=request_hash',
      'UPDATE funnel_daily_counts SET reached_count=2 WHERE step_index=2',
      'UPDATE project_publishers SET grant_id=grant_id',
      'UPDATE admin_changes SET action=action',
    ];
    for (const sql of protectedWrites) {
      let rejected = false;
      try { await recovered.batch([recovered.prepare(sql)]); } catch { rejected = true; }
      if (!rejected) throw Error('restored_protection_failed');
    }
    if ((await restoreFingerprint(recovered)).fingerprint !== after.fingerprint) throw Error('rejected_write_changed_data');
    phase = 'verify-publishers';
    const publisherRecovery = await verifyRestoredPublishers(recovered, fixture);
    await restoreIntegrity(recovered);
    const migrations = [];
    for (const name of (await readdir(resolve(root, 'db/migrations'))).filter(name => /^\d{4}_[a-z_]+\.sql$/.test(name)).sort())
      migrations.push({ name, hash: await sha256(await readFile(resolve(root, 'db/migrations', name), 'utf8')) });
    const report = { schemaVersion: 'tallyfin.restore-drill/v1', local: true, syntheticData: true, remoteChanges: false,
      existingDatabasesAccessed: false, node: process.version,
      wrangler: JSON.parse(await readFile(resolve(root, 'node_modules/wrangler/package.json'), 'utf8')).version,
      miniflare: JSON.parse(await readFile(resolve(root, 'node_modules/miniflare/package.json'), 'utf8')).version, migrations,
      backupBytes: bytes.length, backupHash: await sha256(bytes.toString('utf8')), exportMs, restoreMs,
      elapsedMs: performance.now() - started, restored: after, replay: { browser, server }, protectedWritesRejected: protectedWrites.length,
      publisherRecovery, integrity: { quickCheck: 'ok', foreignKeyViolations: 0 } };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    return { ...report, output };
  } catch {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ local: true, syntheticData: true, phase, verified: false }), { flag: 'wx' });
    throw new Error(`Local restore drill failed during ${phase}. Inspect the new .tmp/restore-drill run; remote databases were not accessed.`);
  } finally { await source?.dispose(); await restored?.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('npm run verify:restore\nCreates synthetic local D1 databases, exports/restores SQL, verifies schema, all rows, integrity and replay. No existing or remote database is opened. Artifacts stay in .tmp/restore-drill/. No target or remote options.');
  else if (args.length) { console.error('No options are accepted. Use --help.'); process.exitCode = 1; }
  else runRestoreDrill(controller.signal).then(report => console.log(JSON.stringify(report))).catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
}
