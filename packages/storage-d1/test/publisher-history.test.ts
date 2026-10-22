import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { D1Queries, D1Store, adminChangeStatement } from '../src/index.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { PublisherProvisioner } from '../../../tools/provision/publishers.ts';
import { migrationStatements, now, seed } from './helpers.ts';

test('0008 preserves history and project rows, rebuilds guards, and records owner-readable publisher changes', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}', d1Databases: { DB: 'publisher-history-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements();
    const boundary = statements.findIndex(sql => sql.startsWith('CREATE TABLE admin_changes_next'));
    assert.ok(boundary > 0);
    for (const sql of statements.slice(0, boundary)) await db.prepare(sql).run();
    await seed(db);
    const owner = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
    await db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', owner.issuer, owner.subject, 'owner', now).run();
    await db.batch([adminChangeStatement(db, 'sembom', owner, { action: 'project.created' }, now - 1, 'always')]);
    const before = (await db.prepare('SELECT * FROM admin_changes').all()).results;
    const projects = (await db.prepare('SELECT * FROM projects').all()).results;
    assert.deepEqual(await initialize(db, false), { migrations: ['0008_publisher_history.sql', '0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql'], applied: false });
    assert.deepEqual(await initialize(db, true), { migrations: ['0008_publisher_history.sql', '0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql'], applied: true });
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.deepEqual((await db.prepare('SELECT * FROM admin_changes').all()).results, before);
    assert.deepEqual((await db.prepare('SELECT * FROM projects').all()).results, projects.map(row => ({ ...row, grant_revision: 0 })));
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    const input = { projectId: 'sembom', issuer: 'https://publisher.example.invalid', subject: 'test-machine' };
    const tool = new PublisherProvisioner(db);
    await tool.apply(await tool.plan('publisher-grant', input), now);
    await tool.apply(await tool.plan('publisher-grant', input), now + 1);
    await tool.apply(await tool.plan('publisher-revoke', input), now + 2);
    const page = await new D1Queries(db).changes(owner, 'sembom', 25, '', now + 2);
    assert.deepEqual(page.data.map(row => row.change.action), ['publisher.revoked', 'publisher.granted', 'project.created']);
    assert.deepEqual(page.data[0]!.actor, { kind: 'local_operator' });
    assert.deepEqual(page.data[0]!.change, { action: 'publisher.revoked', target: { issuer: input.issuer, subject: input.subject } });
    await assert.rejects(db.prepare('UPDATE admin_changes SET target_subject=?').bind('changed').run());
    await assert.rejects(db.prepare(`INSERT INTO admin_changes (id,project_id,occurred_at,actor_kind,action,target_issuer,target_subject,before_role)
      VALUES (?,'sembom',?,'local_operator','publisher.granted',?,?,'owner')`).bind(crypto.randomUUID(), now, input.issuer, input.subject).run());
    await assert.rejects(db.prepare(`INSERT INTO admin_changes (id,project_id,occurred_at,actor_kind,action)
      VALUES (?,'sembom',?,'local_operator','publisher.revoked')`).bind(crypto.randomUUID(), now).run());
    await new D1Store(db).cleanup('sembom', 'UTC', now + 91 * 86400000, 10);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM admin_changes').first('n'), 0);
    await db.prepare('DROP TRIGGER immutable_admin_change').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
  } finally { await mf.dispose(); }
});
