import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Provisioner } from '../store.ts';
import { operation } from '../input.ts';
import { runCli } from '../cli.ts';
import { D1Queries } from '@tallyfin/storage-d1';
import { example, seed, setup, now } from '../../../packages/storage-d1/test/helpers.ts';

const issuer = 'https://identity.example.invalid';
const principal = () => ({ projectId: 'sembom', issuer, subject: crypto.randomUUID() });

test('preview writes nothing, registration is atomic and repeated application is a no-op', async () => {
  const f = await setup();
  try {
    const tool = new Provisioner(f.db);
    const input = example('registry'); input.project.id = 'new-product';
    const plan = await tool.plan('register', input);
    assert.ok(plan.changes.length > 0);
    assert.equal(await f.db.prepare("SELECT count(*) AS n FROM projects WHERE id='new-product'").first('n'), 0);
    assert.equal((await tool.apply(plan, now)).applied, true);
    const original = await f.db.prepare("SELECT created_at, ingest_revision FROM projects WHERE id='new-product'").first();
    const repeat = await tool.plan('register', input);
    assert.equal(repeat.changes.length, 0);
    assert.deepEqual(await tool.apply(repeat, now + 10), { applied: false, changes: 0 });
    assert.deepEqual(await f.db.prepare("SELECT created_at, ingest_revision FROM projects WHERE id='new-product'").first(), original);
    assert.equal(await f.db.prepare("SELECT count(*) AS n FROM project_schemas WHERE project_id='new-product'").first('n'), 1);
  } finally { await f.mf.dispose(); }
});

test('project updates and higher versions preserve old definitions and reject immutable edits', async () => {
  const f = await setup();
  try {
    const tool = new Provisioner(f.db);
    const original = await f.db.prepare("SELECT definitions_json FROM project_schemas WHERE project_id='sembom' AND version=1").first('definitions_json');
    const changed = example('registry'); changed.schemaVersion = 2; changed.project.name = 'Updated';
    changed.allowedOrigins = ['https://new.example.invalid']; changed.limits.requestsPerMinute = 40;
    changed.events[0].label = 'Updated label';
    await tool.apply(await tool.plan('register', changed), now);
    assert.equal(await f.db.prepare("SELECT definitions_json FROM project_schemas WHERE project_id='sembom' AND version=1").first('definitions_json'), original);
    assert.equal(await f.db.prepare("SELECT requests_per_minute FROM projects WHERE id='sembom'").first('requests_per_minute'), 40);
    const immutable = structuredClone(changed); immutable.events[0].label = 'overwrite';
    await assert.rejects(tool.plan('register', immutable), { code: 'immutable_schema' });
    const zone = structuredClone(changed); zone.project.timeZone = 'UTC';
    await assert.rejects(tool.plan('register', zone), { code: 'immutable_timezone' });
    const retired = structuredClone(changed); retired.schemaStatus = 'retired'; retired.project.status = 'paused';
    await tool.apply(await tool.plan('register', retired), now + 1);
    assert.equal(await f.db.prepare("SELECT retired_at FROM project_schemas WHERE version=2").first('retired_at'), now + 1);
  } finally { await f.mf.dispose(); }
});

test('grant bootstrap, role changes and revocation recheck query access and preserve the last owner', async () => {
  const f = await setup();
  try {
    const tool = new Provisioner(f.db);
    const first = principal(); const second = principal(); const reader = principal();
    for (const member of [first, second]) await tool.apply(await tool.plan('grant', { ...member, role: 'owner' }), now);
    const plan = await tool.plan('grant', { ...reader, role: 'reader' });
    assert.ok(!JSON.stringify(plan).includes(reader.subject));
    await tool.apply(plan, now);
    assert.equal((await tool.plan('grant', { ...reader, role: 'reader' })).changes.length, 0);
    const queries = new D1Queries(f.db);
    assert.equal((await queries.list(reader, 25, '')).data.length, 1);
    await tool.apply(await tool.plan('revoke', reader), now);
    assert.equal((await queries.list(reader, 25, '')).data.length, 0);
    assert.equal((await tool.plan('revoke', reader)).changes.length, 0);
    const staleOwnerRemoval = await tool.plan('revoke', first);
    await tool.apply(await tool.plan('revoke', second), now);
    await assert.rejects(tool.apply(staleOwnerRemoval, now), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare("SELECT count(*) AS n FROM project_grants WHERE role='owner'").first('n'), 1);
    await assert.rejects(tool.plan('revoke', first), { code: 'last_owner' });
    await assert.rejects(tool.plan('grant', { ...first, role: 'reader' }), { code: 'last_owner' });
  } finally { await f.mf.dispose(); }
});

test('stale plans roll back all writes and grants cannot cross into another project', async () => {
  const f = await setup();
  try {
    await seed(f.db, 'other');
    const tool = new Provisioner(f.db);
    const unchanged = await tool.plan('register', example('registry'));
    assert.equal(unchanged.changes.length, 0);
    await f.db.prepare("UPDATE projects SET ingest_revision=ingest_revision+1 WHERE id='sembom'").run();
    await assert.rejects(tool.apply(unchanged, now), { code: 'apply_conflict' });
    const member = principal();
    const grant = await tool.plan('grant', { ...member, role: 'reader' });
    await f.db.prepare("UPDATE projects SET ingest_revision=ingest_revision+1 WHERE id='sembom'").run();
    await assert.rejects(tool.apply(grant, now), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_grants').first('n'), 0);
    const updated = example('registry'); updated.schemaVersion = 2; updated.project.name = 'Should roll back';
    const plan = await tool.plan('register', updated);
    await f.db.prepare("UPDATE projects SET name='Concurrent' WHERE id='sembom'").run();
    await assert.rejects(tool.apply(plan, now), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_schemas WHERE version=2').first('n'), 0);
    await tool.apply(await tool.plan('grant', { ...member, role: 'reader' }), now);
    const response = await new D1Queries(f.db).list(member, 25, '');
    assert.deepEqual(response.data.map(p => p.id), ['sembom']);
    await assert.rejects(tool.plan('grant', { ...member, projectId: 'missing', role: 'reader' }), { code: 'project_not_found' });
  } finally { await f.mf.dispose(); }
});

test('inputs reject unknown fields, unsafe issuers, wildcards, invalid schemas and remote CLI options', async () => {
  const member = principal();
  for (const input of [{ ...member, role: 'owner', token: 'unused' }, { ...member, issuer: 'http://identity.example.invalid', role: 'reader' },
    { ...member, issuer: `${issuer}?credential=unused`, role: 'reader' }, { ...member, role: 'admin' }])
    assert.throws(() => operation('grant', input), { code: 'invalid_input' });
  const registry = example('registry'); registry.allowedOrigins = ['https://*.example.invalid'];
  assert.throws(() => operation('register', registry), { code: 'invalid_input' });
  registry.allowedOrigins = ['http://localhost:5173'];
  assert.throws(() => operation('register', registry), { code: 'invalid_input' });
  assert.equal(operation('register', registry, true).kind, 'register');
  await assert.rejects(runCli(['register', '--remote']), { code: 'invalid_arguments' });
  await assert.rejects(runCli(['init', '--local', '--local', '--state-dir', 'unused']), { code: 'invalid_arguments' });
});

test('CLI uses persistent local D1, defaults to preview and compares reviewed plan hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-cli-'));
  const state = join(directory, 'state'); const file = join(directory, 'registry.json');
  const input = example('registry');
  await writeFile(file, JSON.stringify(input));
  const output: string[] = [];
  const capture = (line: string) => { output.push(line); };
  const flags = ['--local', '--state-dir', state];
  const invoke = async (args: string[]) => { await runCli(args, capture); return JSON.parse(output.at(-1)!); };
  try {
    assert.equal((await invoke(['init', ...flags])).applied, false);
    assert.equal((await invoke(['init', ...flags, '--apply'])).applied, true);
    assert.equal((await invoke(['init', ...flags, '--apply'])).applied, false);
    const preview = await invoke(['register', ...flags, '--file', file]);
    assert.equal(preview.preview, true); assert.ok(preview.plan.changes.length > 0);
    await assert.rejects(invoke(['register', ...flags, '--file', file, '--apply', '--expect-plan', '0'.repeat(64)]), { code: 'plan_changed' });
    const applied = await invoke(['register', ...flags, '--file', file, '--apply', '--expect-plan', preview.plan.planHash]);
    assert.equal(applied.result.applied, true);
    assert.equal((await invoke(['register', ...flags, '--file', file, '--apply'])).result.applied, false);
    const cli = fileURLToPath(new URL('../cli.ts', import.meta.url));
    const help = await promisify(execFile)(process.execPath, [cli, '--help']);
    assert.match(help.stdout, /preview only/);
    await assert.rejects(promisify(execFile)(process.execPath, [cli, '--remote']), error => {
      const result = error as Error & { code: number; stderr: string };
      assert.equal(result.code, 1); assert.equal(JSON.parse(result.stderr).code, 'invalid_arguments'); return true;
    });
  } finally {
    const absolute = fileURLToPath(new URL(`file:///${directory.replaceAll('\\', '/')}/`));
    assert.ok(absolute.startsWith(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
