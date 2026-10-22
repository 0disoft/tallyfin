import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { initialize } from '../../../tools/provision/local.ts';
import { migrationStatements, now, seed, setup } from './helpers.ts';

test('0009 preserves permissions, backfills unique generations, and rejects incomplete initialization', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}', d1Databases: { DB: 'publisher-generation-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements();
    const boundary = statements.findIndex(sql => sql.startsWith('CREATE TABLE project_publishers_next'));
    assert.ok(boundary > 0);
    await db.batch(statements.slice(0, boundary).map(sql => db.prepare(sql)));
    await seed(db);
    const issuer = 'https://publisher.example.invalid';
    for (const subject of ['a', 'b'])
      await db.prepare('INSERT INTO project_publishers VALUES (?,?,?,?)').bind('sembom', issuer, subject, now).run();
    const before = (await db.prepare('SELECT project_id,issuer,subject,created_at FROM project_publishers ORDER BY subject').all()).results;
    assert.deepEqual(await initialize(db, false), { migrations: ['0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql'], applied: false });
    assert.deepEqual((await db.prepare('PRAGMA table_info(project_publishers)').all()).results.map(row => row.name),
      ['project_id', 'issuer', 'subject', 'created_at']);
    assert.deepEqual(await initialize(db, true), { migrations: ['0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql'], applied: true });
    assert.deepEqual((await db.prepare('SELECT project_id,issuer,subject,created_at FROM project_publishers ORDER BY subject').all()).results, before);
    const ids = (await db.prepare('SELECT grant_id FROM project_publishers').all()).results.map(row => row.grant_id);
    assert.equal(new Set(ids).size, 2); assert.ok(ids.every(id => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)));
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.deepEqual((await db.prepare('SELECT grant_id FROM project_publishers').all()).results.map(row => row.grant_id), ids);
    await db.prepare('CREATE TABLE project_publishers_next (leftover TEXT)').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
    await db.prepare('DROP TABLE project_publishers_next').run();
    await db.prepare('DROP TRIGGER immutable_publisher_generation').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
  } finally { await mf.dispose(); }
});

test('generation is immutable, checked and unique; regrant at the same timestamp gets a new ID', async () => {
  const f = await setup();
  try {
    const insert = () => f.db.prepare('INSERT INTO project_publishers (project_id,issuer,subject,created_at) VALUES (?,?,?,?)')
      .bind('sembom', 'https://publisher.example.invalid', 'test-machine', now).run();
    await insert();
    const old = await f.db.prepare('SELECT grant_id FROM project_publishers').first<string>('grant_id');
    assert.match(old!, /^[0-9a-f]{32}$/);
    await assert.rejects(f.db.prepare('UPDATE project_publishers SET grant_id=?').bind('a'.repeat(32)).run());
    await assert.rejects(f.db.prepare('UPDATE project_publishers SET created_at=?').bind(now + 1).run());
    for (const invalid of [old, null, '', 'a'.repeat(31), 'A'.repeat(32), 'g'.repeat(32)])
      await assert.rejects(f.db.prepare('INSERT INTO project_publishers (project_id,issuer,subject,created_at,grant_id) VALUES (?,?,?,?,?)')
        .bind('sembom', 'https://publisher.example.invalid', 'other', now, invalid).run());
    await f.db.prepare('DELETE FROM project_publishers').run();
    await insert();
    const fresh = await f.db.prepare('SELECT grant_id FROM project_publishers').first<string>('grant_id');
    assert.notEqual(fresh, old);
    assert.equal(await f.db.prepare('SELECT created_at FROM project_publishers').first('created_at'), now);
    assert.equal((await f.db.prepare('DELETE FROM project_publishers WHERE grant_id=?').bind(old).run()).meta.changes, 0);
  } finally { await f.mf.dispose(); }
});
