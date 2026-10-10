import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, unlink, rmdir, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setup, now } from '../../../packages/storage-d1/test/helpers.ts';
import { RemoteCreatorProvisioner, creatorRows, type RemoteCreatorTarget } from '../remote-creators.ts';
import { remoteCreatorQuery } from '../remote-wrangler.ts';
import { runRemoteCreatorCli } from '../remote-cli.ts';
import { ProvisionError } from '../input.ts';
import { installation } from '../../runtime/installation.ts';

// Syntax-only target and identities. Tests never invoke remote Wrangler or authenticate.
const target = (): RemoteCreatorTarget => ({ accountId: crypto.randomUUID().replaceAll('-', ''), databaseId: crypto.randomUUID(),
  databaseName: 'test-db', workerName: 'test-collector', issuer: 'https://identity.example.invalid' });
const input = (t: RemoteCreatorTarget) => ({ issuer: t.issuer, subject: "계정🙂'; DELETE FROM project_grants;--", maxProjects: 5 });

test('single-query preview/grant/update/revoke preserve identities, grant roles and creation history in actual D1', async () => {
  const f = await setup();
  try {
    const t = target(), op = input(t), sqls: string[] = [];
    const tool = new RemoteCreatorProvisioner(t, async sql => { sqls.push(sql); return [await f.db.prepare(sql).all()]; });
    const roles = await f.db.prepare('SELECT * FROM project_grants').all();
    const preview = await tool.plan('creator-grant', op);
    assert.equal(preview.maxProjects, null); assert.equal(preview.createdProjects, 0);
    assert.ok(!JSON.stringify(preview).includes(op.subject)); assert.ok(!JSON.stringify(preview).includes(op.issuer));
    assert.deepEqual(await tool.apply(preview, now), { applied: true, changes: 1 });
    assert.equal(await f.db.prepare('SELECT subject FROM project_creators').first('subject'), op.subject);
    assert.deepEqual(await tool.apply(await tool.plan('creator-grant', op), now + 1), { applied: false, changes: 0 });
    assert.equal(await f.db.prepare('SELECT created_at FROM project_creators').first('created_at'), now);
    await f.db.prepare('INSERT INTO project_creations VALUES (?,?,?,?,?)').bind('sembom', op.issuer, op.subject, 'a'.repeat(64), now).run();
    const update = await tool.plan('creator-grant', { ...op, maxProjects: 1 });
    assert.equal(update.createdProjects, 1); await tool.apply(update, now + 2);
    assert.equal(await f.db.prepare('SELECT created_at FROM project_creators').first('created_at'), now);
    await tool.apply(await tool.plan('creator-revoke', { issuer: op.issuer, subject: op.subject }), now + 3);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creators').first('n'), 0);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creations').first('n'), 1);
    assert.deepEqual((await f.db.prepare('SELECT * FROM project_grants').all()).results, roles.results);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM admin_changes').first('n'), 0);
    assert.ok(sqls.every(sql => !sql.includes(op.subject) && !sql.includes(';')));
  } finally { await f.mf.dispose(); }
});

test('CAS detects concurrent grant, revoke/regrant timestamps, changed use counts and no-op drift', async () => {
  const f = await setup();
  try {
    const t = target(), op = input(t), query = async (sql: string) => [await f.db.prepare(sql).all()];
    const a = new RemoteCreatorProvisioner(t, query), b = new RemoteCreatorProvisioner(t, query);
    const stale = await a.plan('creator-grant', op); await b.apply(await b.plan('creator-grant', op), now);
    await assert.rejects(a.apply(stale, now), { code: 'apply_conflict' });
    const old = await a.plan('creator-revoke', { issuer: op.issuer, subject: op.subject });
    await b.apply(await b.plan('creator-revoke', { issuer: op.issuer, subject: op.subject }), now + 1);
    await b.apply(await b.plan('creator-grant', op), now + 2);
    await assert.rejects(a.apply(old, now + 3), { code: 'apply_conflict' });
    const used = await a.plan('creator-grant', { ...op, maxProjects: 2 });
    await f.db.prepare('INSERT INTO project_creations VALUES (?,?,?,?,?)').bind('sembom', op.issuer, op.subject, 'a'.repeat(64), now).run();
    await assert.rejects(a.apply(used, now + 4), { code: 'apply_conflict' });
    const noop = await a.plan('creator-grant', op);
    await b.apply(await b.plan('creator-grant', { ...op, maxProjects: 3 }), now + 5);
    await assert.rejects(a.apply(noop, now + 6), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare('SELECT max_projects FROM project_creators').first('max_projects'), 3);
  } finally { await f.mf.dispose(); }
});

test('plans bind exact installation targets and are one-use, tool-owned and independent of edited display fields', async () => {
  const f = await setup();
  try {
    const t = target(), op = input(t), query = async (sql: string) => [await f.db.prepare(sql).all()];
    const tool = new RemoteCreatorProvisioner(t, query), plan = await tool.plan('creator-grant', op);
    const other = new RemoteCreatorProvisioner({ ...t, databaseId: crypto.randomUUID() }, query);
    assert.notEqual((await other.plan('creator-grant', op)).planHash, plan.planHash);
    await assert.rejects(other.apply(plan), { code: 'invalid_plan' });
    await assert.rejects(tool.apply(structuredClone(plan)), { code: 'invalid_plan' });
    plan.operation = 'creator-revoke'; plan.changes = []; op.subject = 'changed';
    await tool.apply(plan, now);
    assert.equal(await f.db.prepare('SELECT subject FROM project_creators').first('subject'), input(t).subject);
    await assert.rejects(tool.apply(plan), { code: 'invalid_plan' });
  } finally { await f.mf.dispose(); }
});

test('unsafe input fails before remote reads and transport or malformed DB failures never leak private details', async () => {
  const t = target(), op = input(t); let calls = 0;
  const tool = new RemoteCreatorProvisioner(t, async () => { calls++; throw Error('private-detail'); });
  for (const value of [{ ...op, role: 'owner' }, { ...op, token: 'private-detail' }, { ...op, issuer: t.issuer + '/other' },
    { ...op, maxProjects: 0 }, { ...op, subject: '\ud800' }]) await assert.rejects(tool.plan('creator-grant', value));
  assert.equal(calls, 0);
  await assert.rejects(tool.plan('creator-grant', op), error => {
    assert.equal((error as { code: string }).code, 'database_unavailable'); assert.ok(!(error as Error).message.includes('private-detail')); return true;
  });
  for (const value of [null, [], [{ success: false, results: [] }], [{ success: true, results: {} }], [{ success: true, results: [] }, { success: true, results: [] }]])
    assert.throws(() => creatorRows(value), { code: 'database_unavailable' });
  const corrupted = new RemoteCreatorProvisioner(t, async () => [{ success: true, results: [{ maxProjects: null, grantedAt: now, createdProjects: 0 }] }]);
  await assert.rejects(corrupted.plan('creator-grant', op), { code: 'database_unavailable' });
  const cleanup = new RemoteCreatorProvisioner(t, async () => { throw new ProvisionError('cleanup_failed', 'private-detail'); });
  await assert.rejects(cleanup.plan('creator-grant', op), error => {
    assert.equal((error as { code: string }).code, 'cleanup_failed'); assert.ok(!(error as Error).message.includes('private-detail')); return true;
  });
});

test('Wrangler transport fixes DB/account, isolates config and env files, suppresses logs and cleans up after success/failure', async () => {
  const t = target(); let directory = '';
  const query = remoteCreatorQuery('C:/local-test-root', t, async (file, args, options) => {
    directory = options.cwd; assert.equal(file, process.execPath);
    assert.ok(args.includes('--remote')); assert.ok(args.includes('--json')); assert.ok(!args.includes('--file')); assert.ok(!args.includes('--yes'));
    assert.deepEqual(args.slice(-2), ['--command', 'SELECT 1']);
    const config = JSON.parse(await readFile(args[args.indexOf('--config') + 1]!, 'utf8'));
    assert.equal(config.account_id, t.accountId); assert.equal(config.d1_databases[0].database_id, t.databaseId);
    assert.equal(Object.hasOwn(config, 'env'), false);
    assert.equal(await readFile(args[args.indexOf('--env-file') + 1]!, 'utf8'), '');
    assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false'); assert.equal(options.env.CLOUDFLARE_API_BASE_URL, undefined);
    assert.equal(options.windowsHide, true); return { stdout: '[{"success":true,"results":[{"value":1}]}]' };
  });
  assert.deepEqual(await query('SELECT 1'), [{ success: true, results: [{ value: 1 }] }]);
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
  const fail = remoteCreatorQuery('C:/local-test-root', t, async (_, __, options) => { directory = options.cwd; throw Error('private-detail'); });
  await assert.rejects(fail('SELECT 1'), error => { assert.ok(!(error as Error).message.includes('private-detail')); return true; });
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
});

test('remote CLI requires reviewed hashes for writes and refuses bad arguments or edited installation before any query', async () => {
  let calls = 0; const query = async () => { calls++; return [{ success: true, results: [{ maxProjects: null, grantedAt: null, createdProjects: 0 }] }]; };
  for (const args of [[], ['grant'], ['creator-grant', '--local'], ['creator-grant', '--remote', '--dir', 'x', '--file', 'x', '--apply'],
    ['creator-grant', '--remote', '--dir', 'x', '--file', 'x', '--expect-plan', 'a'.repeat(64)],
    ['creator-grant', '--remote', '--remote'], ['creator-grant', '--command', 'DELETE']]) await assert.rejects(runRemoteCreatorCli(args, () => {}, query), { code: 'invalid_arguments' });
  assert.equal(calls, 0);
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-remote-cli-test-')), prepared = join(directory, 'prepared');
  const root = fileURLToPath(new URL('../../../', import.meta.url)), t = target(), file = join(directory, 'identity.json');
  await mkdir(prepared);
  const config = { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId: t.accountId, collectorWorkerName: t.workerName, workersDev: true },
    collector: { workerName: t.workerName, accountId: t.accountId, databaseId: t.databaseId, databaseName: t.databaseName, workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: t.issuer, OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: t.issuer + '/jwks' } },
    login: { issuer: t.issuer, clientId: 'public-test-client', scope: 'openid profile' } };
  const plan = installation(config, root, prepared);
  const files = { 'installation.json': plan.manifest, 'admin.wrangler.json': plan.admin, 'collector.wrangler.json': plan.collector,
    'admin-login.json': plan.loginSettings, 'oidc-registration.json': plan.registration };
  try {
    for (const [name, data] of Object.entries(files)) await writeFile(join(prepared, name), JSON.stringify(data));
    await writeFile(file, JSON.stringify(input(t)));
    const args = ['creator-grant', '--remote', '--dir', prepared, '--file', file]; let output = '';
    await runRemoteCreatorCli(args, line => { output = line; }, query); const preview = JSON.parse(output);
    assert.equal(preview.preview, true); assert.equal(preview.result.applied, false); assert.equal(calls, 1);
    assert.ok(!output.includes(input(t).subject)); assert.ok(!output.includes(t.issuer));
    await assert.rejects(runRemoteCreatorCli([...args, '--apply', '--expect-plan', 'a'.repeat(64)], () => {}, query), { code: 'plan_changed' });
    assert.equal(calls, 2);
    let appliedCalls = 0;
    await runRemoteCreatorCli([...args, '--apply', '--expect-plan', preview.plan.planHash], line => { output = line; }, async sql => {
      appliedCalls++; return sql.startsWith('SELECT') ? await query() : [{ success: true, results: [{ changed: 1 }] }];
    });
    assert.equal(appliedCalls, 2); assert.equal(JSON.parse(output).result.applied, true);
    await writeFile(join(prepared, 'collector.wrangler.json'), '{}');
    const before = calls; await assert.rejects(runRemoteCreatorCli(args, () => {}, query), { code: 'invalid_target' }); assert.equal(calls, before);
  } finally {
    for (const name of Object.keys(files)) await unlink(join(prepared, name));
    await unlink(file); await rmdir(prepared); await rmdir(directory);
  }
});

test('installed Wrangler accepts isolated config/env and returns the exact query/RETURNING protocol on local D1 only', async () => {
  const t = target(), root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-wrangler-creator-test-'));
  const execute = promisify(execFile); let invocations = 0; const scratch: string[] = [];
  const query = remoteCreatorQuery(root, t, async (file, args, options) => {
    assert.equal(args.filter(arg => arg === '--remote').length, 1);
    const localArgs = args.map(arg => arg === '--remote' ? '--local' : arg);
    localArgs.push('--persist-to', directory); invocations++; scratch.push(options.cwd);
    return execute(file, localArgs, options);
  });
  try {
    await query('CREATE TABLE project_creators(issuer TEXT,subject TEXT,max_projects INTEGER,created_at INTEGER,PRIMARY KEY(issuer,subject)); CREATE TABLE project_creations(issuer TEXT,subject TEXT)');
    const tool = new RemoteCreatorProvisioner(t, query), op = input(t);
    const plan = await tool.plan('creator-grant', op); assert.equal(plan.maxProjects, null);
    assert.deepEqual(await tool.apply(plan, now), { applied: true, changes: 1 });
    const after = await tool.plan('creator-grant', op); assert.equal(after.maxProjects, 5);
    assert.deepEqual(after.changes, []); assert.equal(invocations, 4);
    for (const path of scratch) await assert.rejects(readdir(path), { code: 'ENOENT' });
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
