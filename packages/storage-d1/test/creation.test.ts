import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { parseProjectCreation } from '@tallyfin/core';
import { createProject, projectCreationAccess } from '../src/creation.ts';
import type { SqlDatabase, SqlStatement } from '../src/sql.ts';
import { CreatorProvisioner, creatorOperation } from '../../../tools/provision/creators.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { setup, now } from './helpers.ts';

let f: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'test-creator' };
const input = { id: 'new-product', name: 'New product', timeZone: 'Asia/Seoul', allowedOrigins: ['https://new.example.invalid'],
  limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 } };
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  await f.db.prepare('DELETE FROM admin_changes').run();
  await f.db.prepare("DELETE FROM project_grants WHERE project_id != 'sembom'").run();
  await f.db.prepare('DELETE FROM project_creations').run();
  await f.db.prepare("DELETE FROM projects WHERE id != 'sembom'").run();
  await f.db.prepare('DELETE FROM project_creators').run();
  await f.db.prepare('INSERT INTO project_creators VALUES (?,?,?,?)').bind(principal.issuer, principal.subject, 2, now).run();
});
test('creation atomically stores project, receipt and authenticated owner, with no schema or usage', async () => {
  const result = await createProject(f.db, principal, input, now);
  assert.equal(result.projectId, input.id); assert.equal(result.createdAt, new Date(now).toISOString());
  assert.match(result.creationHash, /^[0-9a-f]{64}$/);
  const rows = await f.db.prepare("SELECT * FROM project_grants WHERE project_id='new-product'").all();
  assert.equal(rows.results.length, 1); assert.equal(rows.results[0]!.subject, principal.subject); assert.equal(rows.results[0]!.role, 'owner');
  assert.equal(await f.db.prepare("SELECT count(*) AS n FROM project_schemas WHERE project_id='new-product'").first('n'), 0);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM ingest_daily_usage').first('n'), 0);
});
test('retries retain the initial result after settings edits and never regain revoked ownership', async () => {
  const original = await createProject(f.db, principal, input, now);
  await f.db.prepare("UPDATE projects SET name='edited', ingest_revision=7 WHERE id='new-product'").run();
  assert.deepEqual(await createProject(f.db, principal, input, now + 100), original);
  assert.equal(await f.db.prepare("SELECT name FROM projects WHERE id='new-product'").first('name'), 'edited');
  await assert.rejects(createProject(f.db, principal, { ...input, name: 'different' }, now), { code: 'project_conflict' });
  await f.db.prepare("UPDATE project_grants SET role='reader' WHERE project_id='new-product'").run();
  await assert.rejects(createProject(f.db, principal, input, now), { code: 'forbidden' });
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creations').first('n'), 1);
});
test('project ownership alone does not confer creation permission; issuer and creator are isolated', async () => {
  await f.db.prepare('DELETE FROM project_creators').run();
  await f.db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'owner',?)").bind(principal.issuer, principal.subject, now).run();
  await assert.rejects(projectCreationAccess(f.db, principal), { code: 'forbidden' });
  await f.db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(principal.issuer, principal.subject, now).run();
  await createProject(f.db, principal, input, now);
  const other = { ...principal, subject: 'other-creator' };
  await f.db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(other.issuer, other.subject, now).run();
  await assert.rejects(createProject(f.db, other, input, now), { code: 'project_conflict' });
  await assert.rejects(createProject(f.db, { ...principal, issuer: 'https://other.example.invalid' }, input, now), { code: 'forbidden' });
  await assert.rejects(createProject(f.db, principal, { ...input, id: 'sembom' }, now), { code: 'project_conflict' });
});
test('concurrent quota and same-ID requests create exactly once; retries still work at capacity', async () => {
  await f.db.prepare('UPDATE project_creators SET max_projects=1').run();
  const attempts = await Promise.allSettled([createProject(f.db, principal, input, now), createProject(f.db, principal, { ...input, id: 'other' }, now)]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected')?.reason.code, 'project_limit_reached');
  const winner = attempts.find(r => r.status === 'fulfilled')!.value;
  assert.deepEqual(await createProject(f.db, principal, { ...input, id: winner.projectId }, now + 1), winner);
  await f.db.prepare('UPDATE project_creators SET max_projects=2').run();
  const same = await Promise.all([createProject(f.db, principal, { ...input, id: 'same-id' }, now), createProject(f.db, principal, { ...input, id: 'same-id' }, now + 1)]);
  assert.deepEqual(same[0], same[1]);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creations').first('n'), 2);
});
test('permission revocation between read and write prevents every insertion; failures roll back all rows', async () => {
  let calls = 0;
  const revoked: SqlDatabase = { prepare: f.db.prepare.bind(f.db), async batch<T>(statements: SqlStatement[]) {
    if (++calls === 2) await f.db.prepare('DELETE FROM project_creators').run();
    return f.db.batch<T>(statements);
  } };
  await assert.rejects(createProject(revoked, principal, input, now), { code: 'forbidden' });
  assert.equal(await f.db.prepare("SELECT count(*) AS n FROM projects WHERE id='new-product'").first('n'), 0);
  await f.db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(principal.issuer, principal.subject, now).run();
  await f.db.prepare("CREATE TRIGGER reject_owner BEFORE INSERT ON project_grants BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try { await assert.rejects(createProject(f.db, principal, input, now)); }
  finally { await f.db.prepare('DROP TRIGGER reject_owner').run(); }
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creations').first('n'), 0);
  assert.equal(await f.db.prepare("SELECT count(*) AS n FROM projects WHERE id='new-product'").first('n'), 0);
});
test('creation parsing is closed, checks time zones/origins and canonicalizes origin order', async () => {
  for (const value of [{ ...input, id: 'Invalid' }, { ...input, name: ' ' }, { ...input, timeZone: 'not-a-zone' },
    { ...input, status: 'active' }, { ...input, owner: principal }, { ...input, limits: { requestsPerMinute: 120 } },
    { ...input, allowedOrigins: ['https://*.invalid'] }, { ...input, allowedOrigins: ['http://localhost:5173'] }])
    assert.throws(() => parseProjectCreation(value), { code: 'invalid_request' });
  assert.equal(parseProjectCreation({ ...input, allowedOrigins: ['http://localhost:5173'] }, { allowLocalHttp: true }).id, input.id);
  const origins = ['https://z.example.invalid', 'https://a.example.invalid'];
  assert.deepEqual(await createProject(f.db, principal, { ...input, allowedOrigins: origins }, now),
    await createProject(f.db, principal, { ...input, allowedOrigins: origins.toReversed() }, now + 1));
});
test('creator CLI plans redact identity, support CAS and preserve creation history on revoke/regrant', async () => {
  const tool = new CreatorProvisioner(f.db), args = { ...principal, maxProjects: 1 };
  const plan = await tool.plan('creator-grant', args);
  assert.ok(!JSON.stringify(plan).includes(principal.subject));
  await createProject(f.db, principal, input, now);
  await assert.rejects(tool.apply(plan, now), { code: 'apply_conflict' });
  await tool.apply(await tool.plan('creator-revoke', principal), now);
  await assert.rejects(createProject(f.db, principal, input, now), { code: 'forbidden' });
  await tool.apply(await tool.plan('creator-grant', args), now);
  assert.equal((await tool.plan('creator-grant', args)).createdProjects, 1);
  assert.deepEqual(await tool.apply(await tool.plan('creator-grant', args), now), { applied: false, changes: 0 });
  await assert.rejects(createProject(f.db, principal, { ...input, id: 'too-many' }, now), { code: 'project_limit_reached' });
  for (const value of [{ ...args, maxProjects: 0 }, { ...args, maxProjects: 1001 }, { ...args, role: 'owner' }, { ...args, issuer: 'http://unsafe.invalid' }])
    assert.throws(() => creatorOperation('creator-grant', value), { code: 'invalid_input' });
});
test('0003 upgrades an existing DB without backfilling authority or changing projects and schemas', async () => {
  const before = await f.db.prepare("SELECT * FROM projects WHERE id='sembom'").first();
  const schema = await f.db.prepare("SELECT * FROM project_schemas WHERE project_id='sembom'").all();
  await f.db.prepare('DROP TABLE project_creations').run();
  await f.db.prepare('DROP TABLE project_creators').run();
  assert.deepEqual(await initialize(f.db, false), { migrations: ['0003_project_creation.sql'], applied: false });
  assert.deepEqual(await initialize(f.db, true), { migrations: ['0003_project_creation.sql'], applied: true });
  assert.deepEqual(await f.db.prepare("SELECT * FROM projects WHERE id='sembom'").first(), before);
  assert.deepEqual((await f.db.prepare("SELECT * FROM project_schemas WHERE project_id='sembom'").all()).results, schema.results);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creators').first('n'), 0);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creations').first('n'), 0);
  assert.deepEqual(await initialize(f.db, true), { migrations: [], applied: false });
});
