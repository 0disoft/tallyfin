import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { ADMIN_CHANGE_RETENTION_DAYS, DAY } from '@tallyfin/core';
import { adminChangeStatement, D1Queries } from '../src/index.ts';
import { Provisioner } from '../../../tools/provision/store.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { example, now, prepare, registry, seed, setup } from './helpers.ts';

let f: Awaited<ReturnType<typeof setup>>;
const owner = { issuer: 'https://identity.example.invalid', subject: 'history-owner' };
const target = { issuer: owner.issuer, subject: 'history-target' };
const creation = { id: 'new-product', name: 'Unstored setting value', timeZone: 'UTC',
  allowedOrigins: ['https://new.example.invalid'], limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 } };
const publication = { expectedLatestVersion: 1, privacyReviewed: true as const, events: registry.events, workflows: registry.workflows };
before(async () => { f = await setup(); await seed(f.db, 'other'); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['admin_changes', 'project_creations', 'project_creators', 'project_grants']) await f.db.prepare(`DELETE FROM ${table}`).run();
  await f.db.prepare("DELETE FROM project_schemas WHERE version > 1 OR project_id='new-product'").run();
  await f.db.prepare("DELETE FROM projects WHERE id='new-product'").run();
  await f.db.prepare("UPDATE projects SET name=?, status='active', allowed_origins_json=?, requests_per_minute=120, new_receipts_per_utc_day=100000 WHERE id='sembom'")
    .bind(registry.project.name, JSON.stringify(registry.allowedOrigins)).run();
  await f.db.prepare("INSERT INTO project_grants VALUES (?,?,?,'owner',?)").bind('sembom', owner.issuer, owner.subject, now).run();
  await f.db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(owner.issuer, owner.subject, now).run();
});
const rows = async () => (await f.db.prepare('SELECT * FROM admin_changes ORDER BY occurred_at, id').all<any>()).results;

test('API writes atomically record minimal metadata; retries, same values and denied changes add no rows', async () => {
  const q = new D1Queries(f.db);
  const add = { ...target, role: 'reader' as const, expectedRole: null };
  await q.changeGrant(owner, 'sembom', add, now);
  await q.changeGrant(owner, 'sembom', add, now + 1);
  await q.changeGrant(owner, 'sembom', { ...target, role: 'owner', expectedRole: 'reader' }, now + 2);
  await q.changeGrant(owner, 'sembom', { ...target, role: null, expectedRole: 'owner' }, now + 3);
  await q.changeGrant(owner, 'sembom', { ...target, role: null, expectedRole: 'owner' }, now + 4);
  await assert.rejects(q.changeGrant(owner, 'sembom', { ...owner, role: null, expectedRole: 'owner' }, now), { code: 'last_owner' });
  await assert.rejects(q.changeGrant(target, 'sembom', add, now), { code: 'forbidden' });
  const current = await q.settings(owner, 'sembom');
  await q.updateSettings(owner, 'sembom', { expectedSettingsHash: current.settingsHash, name: current.project.name }, now);
  await q.updateSettings(owner, 'sembom', { expectedSettingsHash: current.settingsHash, name: 'Never stored in history',
    limits: { requestsPerMinute: 10 } }, now + 5);
  await assert.rejects(q.updateSettings(owner, 'sembom', { expectedSettingsHash: current.settingsHash, name: 'stale' }, now), { code: 'settings_conflict' });
  await q.publishSchema(owner, 'sembom', 2, publication, now + 6);
  await q.publishSchema(owner, 'sembom', 2, publication, now + 7);
  await q.createProject(owner, creation, now + 8);
  await q.createProject(owner, creation, now + 9);
  const records = await rows();
  assert.deepEqual(records.map(r => r.action), ['grant.created', 'grant.role_changed', 'grant.revoked', 'project.settings_changed', 'schema.published', 'project.created']);
  assert.deepEqual(records.slice(0, 3).map(r => [r.before_role, r.after_role]), [[null, 'reader'], ['reader', 'owner'], ['owner', null]]);
  assert.ok(records.every(r => r.actor_kind === 'administrator' && r.actor_issuer === owner.issuer && r.actor_subject === owner.subject));
  assert.equal(records[3].fields_json, '["name","requestsPerMinute"]');
  assert.equal(records[4].schema_version, 2);
  assert.equal(records[5].project_id, 'new-product');
  const text = JSON.stringify(records);
  for (const privateValue of ['Never stored in history', creation.name, creation.allowedOrigins[0]!, registry.events[0]!.name])
    assert.ok(!text.includes(privateValue));
});

test('history failure rolls back grant, settings, schema and project creation writes', async () => {
  const q = new D1Queries(f.db), before = await f.db.prepare("SELECT * FROM projects WHERE id='sembom'").first();
  const current = await q.settings(owner, 'sembom');
  await f.db.prepare("CREATE TRIGGER reject_history BEFORE INSERT ON admin_changes BEGIN SELECT RAISE(ABORT, 'test-history-failure'); END").run();
  try {
    await assert.rejects(q.changeGrant(owner, 'sembom', { ...target, role: 'reader', expectedRole: null }, now));
    await assert.rejects(q.updateSettings(owner, 'sembom', { expectedSettingsHash: current.settingsHash, name: 'rollback' }, now));
    await assert.rejects(q.publishSchema(owner, 'sembom', 2, publication, now));
    await assert.rejects(q.createProject(owner, creation, now));
    assert.deepEqual(await f.db.prepare("SELECT * FROM projects WHERE id='sembom'").first(), before);
    assert.equal(await f.db.prepare('SELECT count(*) FROM project_grants').first('count(*)'), 1);
    assert.equal(await f.db.prepare('SELECT count(*) FROM project_creations').first('count(*)'), 0);
    assert.equal(await f.db.prepare("SELECT count(*) FROM projects WHERE id='new-product'").first('count(*)'), 0);
    assert.equal(await f.db.prepare('SELECT count(*) FROM project_schemas WHERE version=2').first('count(*)'), 0);
    assert.equal((await rows()).length, 0);
  } finally { await f.db.prepare('DROP TRIGGER reject_history').run(); }
});

test('offline operator records changes without claiming a human identity; stale plans and no-ops add nothing', async () => {
  const tool = new Provisioner(f.db), input = example('registry'); input.project.id = 'new-product';
  await tool.apply(await tool.plan('register', input), now);
  await tool.apply(await tool.plan('register', input), now + 1);
  await tool.apply(await tool.plan('grant', { projectId: 'new-product', ...target, role: 'owner' }), now + 2);
  const stale = await tool.plan('register', { ...input, project: { ...input.project, name: 'stale' } });
  await f.db.prepare("UPDATE projects SET ingest_revision=ingest_revision+1 WHERE id='new-product'").run();
  await assert.rejects(tool.apply(stale, now), { code: 'apply_conflict' });
  input.project.name = 'Changed name'; input.schemaStatus = 'retired';
  await tool.apply(await tool.plan('register', input), now + 3);
  const records = await rows();
  assert.deepEqual(records.map(r => r.action).sort(), ['project.created', 'schema.published', 'grant.created', 'project.settings_changed', 'schema.status_changed'].sort());
  assert.deepEqual(records.map(r => r.occurred_at), [now, now, now + 2, now + 3, now + 3]);
  assert.ok(records.every(r => r.actor_kind === 'local_operator' && r.actor_issuer === null && r.actor_subject === null));
  assert.equal(records.find(r => r.action === 'grant.created')!.target_subject, target.subject);
  assert.equal(records.find(r => r.action === 'project.settings_changed')!.fields_json, '["name"]');
  await f.db.prepare("CREATE TRIGGER reject_history BEFORE INSERT ON admin_changes BEGIN SELECT RAISE(ABORT, 'test-history-failure'); END").run();
  try {
    await assert.rejects(tool.apply(await tool.plan('grant', { projectId: 'new-product', ...owner, role: 'reader' }), now), { code: 'apply_conflict' });
    assert.equal(await f.db.prepare('SELECT count(*) FROM project_grants WHERE project_id=? AND subject=?').bind('new-product', owner.subject).first('count(*)'), 0);
    assert.equal((await rows()).length, records.length);
    const projectBefore = await f.db.prepare("SELECT * FROM projects WHERE id='new-product'").first();
    input.schemaVersion = 2; input.project.name = 'rolled back';
    await assert.rejects(tool.apply(await tool.plan('register', input), now), { code: 'apply_conflict' });
    assert.deepEqual(await f.db.prepare("SELECT * FROM projects WHERE id='new-product'").first(), projectBefore);
    assert.equal(await f.db.prepare("SELECT count(*) FROM project_schemas WHERE project_id='new-product' AND version=2").first('count(*)'), 0);
  } finally { await f.db.prepare('DROP TRIGGER reject_history').run(); }
});

test('retention deletes bounded expired rows in only the selected project and preserves the exact 90-day boundary', async () => {
  const cutoff = now - ADMIN_CHANGE_RETENTION_DAYS * DAY;
  await f.db.batch([
    ...[cutoff - 2, cutoff - 1, cutoff, now].map(at => adminChangeStatement(f.db, 'sembom', null, { action: 'project.created' }, at, 'always')),
    adminChangeStatement(f.db, 'other', null, { action: 'project.created' }, cutoff - 1, 'always'),
  ]);
  await f.store.cleanup('sembom', 'UTC', now, 1);
  assert.equal((await rows()).length, 4);
  await f.store.cleanup('sembom', 'UTC', now, 1);
  const records = await rows();
  assert.equal(records.length, 3);
  assert.deepEqual(records.filter(r => r.project_id === 'sembom').map(r => r.occurred_at), [cutoff, now]);
  assert.equal(records.find(r => r.project_id === 'other')!.occurred_at, cutoff - 1);
});

test('additive migration upgrades once without backfill or changing existing project data, and history is immutable', async () => {
  const before = await f.db.prepare('SELECT * FROM projects ORDER BY id').all();
  await f.db.prepare('DROP TABLE admin_changes').run();
  assert.deepEqual(await initialize(f.db, false), { migrations: ['0005_admin_changes.sql', '0008_publisher_history.sql'], applied: false });
  assert.deepEqual(await initialize(f.db, true), { migrations: ['0005_admin_changes.sql', '0008_publisher_history.sql'], applied: true });
  assert.deepEqual(await initialize(f.db, true), { migrations: [], applied: false });
  assert.deepEqual((await f.db.prepare('SELECT * FROM projects ORDER BY id').all()).results, before.results);
  assert.equal((await rows()).length, 0);
  await f.db.batch([adminChangeStatement(f.db, 'sembom', null, { action: 'project.created' }, now, 'always')]);
  await assert.rejects(f.db.prepare("UPDATE admin_changes SET action='schema.published'").run());
  await assert.rejects(f.db.prepare('INSERT INTO admin_changes SELECT id || ?,project_id,occurred_at,actor_kind,actor_issuer,actor_subject,action,fields_json,schema_version,target_issuer,target_subject,before_role,after_role FROM admin_changes').bind('bad').run());
  for (const fields of ['["name","name"]', '["unexpected raw setting value"]', '[7]'])
    await assert.rejects(f.db.prepare(`INSERT INTO admin_changes (id,project_id,occurred_at,actor_kind,action,fields_json)
      VALUES (?, 'sembom', ?, 'local_operator', 'project.settings_changed', ?)`).bind(crypto.randomUUID(), now, fields).run());
  assert.equal((await rows()).length, 1);
});

test('normal visitor ingestion adds no administrator history or extra history statements', async () => {
  await f.store.commit(await prepare(), registry);
  assert.equal((await rows()).length, 0);
});
