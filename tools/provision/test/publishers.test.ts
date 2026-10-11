import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { PublisherProvisioner, publisherOperation } from '../publishers.ts';
import { runCli } from '../cli.ts';
import { openLocal } from '../local.ts';
import { example, now, seed, setup } from '../../../packages/storage-d1/test/helpers.ts';

const issuer = 'https://machine.example.invalid';
const principal = () => ({ projectId: 'sembom', issuer, subject: crypto.randomUUID() });
test('publisher preview, grant, retry and revoke preserve administrator authority and original creation time', async () => {
  const f = await setup();
  try {
    const input = principal(); const tool = new PublisherProvisioner(f.db);
    await f.db.prepare("INSERT INTO project_grants VALUES (?,?,?,'owner',?)").bind(input.projectId, input.issuer, input.subject, now).run();
    await assert.rejects(f.store.publisherAccess(input.projectId, input), { code: 'forbidden' });
    const plan = await tool.plan('publisher-grant', input);
    assert.deepEqual(plan.changes, [{ target: 'publisher', field: 'granted', before: false, after: true }]);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 0);
    assert.match(plan.principalHash, /^[0-9a-f]{64}$/); assert.match(plan.planHash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(plan).includes(input.issuer)); assert.ok(!JSON.stringify(plan).includes(input.subject));
    assert.deepEqual(await tool.apply(plan, now), { applied: true, changes: 1 });
    await f.store.publisherAccess(input.projectId, input);
    const retry = await tool.plan('publisher-grant', input);
    assert.equal(retry.granted, true); assert.deepEqual(retry.changes, []);
    assert.deepEqual(await tool.apply(retry, now + 100), { applied: false, changes: 0 });
    assert.equal(await f.db.prepare('SELECT created_at FROM project_publishers').first('created_at'), now);
    await seed(f.db, 'other');
    await assert.rejects(f.store.publisherAccess('other', input), { code: 'forbidden' });
    const other = await tool.plan('publisher-grant', { ...input, projectId: 'other' });
    await tool.apply(other, now + 1);
    await tool.apply(await tool.plan('publisher-revoke', input), now + 2);
    await assert.rejects(f.store.publisherAccess('sembom', input), { code: 'forbidden' });
    await f.store.publisherAccess('other', input);
    assert.deepEqual(await tool.apply(await tool.plan('publisher-revoke', input), now + 3), { applied: false, changes: 0 });
    assert.equal(await f.db.prepare('SELECT role FROM project_grants').first('role'), 'owner');
    const changes = (await f.db.prepare('SELECT actor_kind,action,target_issuer,target_subject,before_role,after_role FROM admin_changes ORDER BY occurred_at').all()).results;
    assert.deepEqual(changes.map(row => row.action), ['publisher.granted', 'publisher.granted', 'publisher.revoked']);
    assert.ok(changes.every(row => row.actor_kind === 'local_operator' && row.target_issuer === input.issuer &&
      row.target_subject === input.subject && row.before_role === null && row.after_role === null));
  } finally { await f.mf.dispose(); }
});

test('publisher permission and history roll back together when history cannot be written', async () => {
  const f = await setup();
  try {
    const input = principal(), tool = new PublisherProvisioner(f.db), plan = await tool.plan('publisher-grant', input);
    await f.db.prepare(`CREATE TRIGGER reject_publisher_history BEFORE INSERT ON admin_changes
      WHEN NEW.action = 'publisher.granted' BEGIN SELECT RAISE(ABORT, 'test_failure'); END;`).run();
    await assert.rejects(tool.apply(plan, now), { code: 'database_unavailable' });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 0);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM admin_changes').first('n'), 0);
  } finally { await f.mf.dispose(); }
});

test('stale grants, revoke/regrant changes and project replacement cannot be applied from an old plan', async () => {
  const f = await setup();
  try {
    const input = principal(); const a = new PublisherProvisioner(f.db); const b = new PublisherProvisioner(f.db);
    const first = await a.plan('publisher-grant', input); const stale = await b.plan('publisher-grant', input);
    await a.apply(first, now);
    await assert.rejects(b.apply(stale, now), { code: 'apply_conflict' });
    const revoke = await a.plan('publisher-revoke', input);
    const oldId = await f.db.prepare('SELECT grant_id FROM project_publishers').first('grant_id');
    await b.apply(await b.plan('publisher-revoke', input), now);
    await b.apply(await b.plan('publisher-grant', input), now);
    assert.notEqual(await f.db.prepare('SELECT grant_id FROM project_publishers').first('grant_id'), oldId);
    await assert.rejects(a.apply(revoke, now + 3), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare('SELECT created_at FROM project_publishers').first('created_at'), now);
    const noop = await a.plan('publisher-grant', input);
    await b.apply(await b.plan('publisher-revoke', input), now + 4);
    await assert.rejects(a.apply(noop), { code: 'apply_conflict' });
    const replaced = await a.plan('publisher-grant', input);
    await f.db.prepare("UPDATE projects SET created_at=? WHERE id='sembom'").bind(now + 10).run();
    await assert.rejects(a.apply(replaced), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 0);
    await assert.rejects(a.plan('publisher-grant', { ...input, projectId: 'unknown' }), { code: 'project_not_found' });
  } finally { await f.mf.dispose(); }
});

test('publisher plans are tied to the issuing tool, one-use and independent of mutable output/input fields', async () => {
  const f = await setup();
  try {
    const input = principal(); const subject = input.subject;
    const tool = new PublisherProvisioner(f.db); const other = new PublisherProvisioner(f.db);
    const plan = await tool.plan('publisher-grant', input);
    await assert.rejects(other.apply(plan), { code: 'invalid_plan' });
    await assert.rejects(tool.apply(structuredClone(plan)), { code: 'invalid_plan' });
    input.subject = 'changed-after-preview';
    plan.operation = 'publisher-revoke'; plan.projectId = 'other'; plan.changes = [];
    await tool.apply(plan, now);
    assert.equal(await f.db.prepare('SELECT subject FROM project_publishers').first('subject'), subject);
    await assert.rejects(tool.apply(plan), { code: 'invalid_plan' });
    const invalidTime = await tool.plan('publisher-grant', input);
    await assert.rejects(tool.apply(invalidTime, NaN), { code: 'invalid_time' });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 1);
  } finally { await f.mf.dispose(); }
});

test('publisher input rejects extra privileges, unsafe identity and broken DB results without private errors', async () => {
  const input = principal();
  for (const value of [{ ...input, role: 'owner' }, { ...input, token: 'private-detail' }, { ...input, projectId: '../other' },
    { ...input, issuer: 'http://identity.invalid' }, { ...input, issuer: issuer + '?private-detail=1' },
    { ...input, subject: '' }, { ...input, subject: 'bad\nsubject' }, { ...input, issuer: 1 }])
    assert.throws(() => publisherOperation('publisher-grant', value), { code: 'invalid_input' });
  assert.throws(() => publisherOperation('grant', input), { code: 'invalid_input' });
  const f = await setup();
  try {
    let fail = false;
    const db: SqlDatabase = { prepare: sql => f.db.prepare(sql), batch: async <T>(statements: Parameters<SqlDatabase['batch']>[0]) => {
      if (fail) throw Error('private-detail'); return f.db.batch<T>(statements as Parameters<typeof f.db.batch>[0]);
    } };
    const tool = new PublisherProvisioner(db); const plan = await tool.plan('publisher-grant', input);
    fail = true;
    await assert.rejects(tool.apply(plan), error => {
      assert.equal((error as { code: string }).code, 'database_unavailable');
      assert.ok(!(error as Error).message.includes('private-detail')); return true;
    });
    await assert.rejects(tool.plan('publisher-grant', input), { code: 'database_unavailable' });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 0);
  } finally { await f.mf.dispose(); }
});

test('CLI persists reviewed publisher grants only on explicit apply and rejects stale hashes before writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-publishers-'));
  const state = join(directory, 'state'); const registryFile = join(directory, 'registry.json'); const identityFile = join(directory, 'publisher.json');
  const input = principal(); const flags = ['--local', '--state-dir', state]; const lines: string[] = [];
  const write = (line: string) => { lines.push(line); };
  try {
    await writeFile(registryFile, JSON.stringify(example('registry'))); await writeFile(identityFile, JSON.stringify(input));
    await runCli(['init', ...flags, '--apply'], write);
    await runCli(['register', ...flags, '--file', registryFile, '--apply'], write);
    const command = ['publisher-grant', ...flags, '--file', identityFile];
    await runCli(command, write);
    const preview = JSON.parse(lines.at(-1)!);
    assert.equal(preview.preview, true); assert.equal(preview.result.applied, false);
    assert.ok(!lines.at(-1)!.includes(input.issuer)); assert.ok(!lines.at(-1)!.includes(input.subject));
    const read = async () => { const local = await openLocal(state); try { return await local.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'); } finally { await local.close(); } };
    assert.equal(await read(), 0);
    await runCli([...command, '--apply', '--expect-plan', preview.plan.planHash], write);
    assert.equal(JSON.parse(lines.at(-1)!).result.applied, true);
    await assert.rejects(runCli([...command, '--apply', '--expect-plan', preview.plan.planHash], write), { code: 'plan_changed' });
    await runCli(['publisher-revoke', ...flags, '--file', identityFile], write);
    const revoke = JSON.parse(lines.at(-1)!);
    assert.equal(revoke.plan.granted, true); assert.equal(revoke.preview, true);
    await runCli(['publisher-revoke', ...flags, '--file', identityFile, '--apply', '--expect-plan', revoke.plan.planHash], write);
    await assert.rejects(runCli([...command, '--remote'], write), { code: 'invalid_arguments' });
    await writeFile(identityFile, JSON.stringify({ ...input, role: 'owner' }));
    await assert.rejects(runCli([...command, '--apply'], write), { code: 'invalid_input' });
    assert.equal(await read(), 0);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
