import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { initialize } from '../../../tools/provision/local.ts';
import { migrationStatements, seed, now } from './helpers.ts';

test('grant migration preserves rows, tracks direct SQL changes and refuses incomplete or overflowing revisions', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}', d1Databases: { DB: 'grant-revision-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements();
    const boundary = statements.findIndex(sql => sql.startsWith('ALTER TABLE projects ADD COLUMN grant_revision'));
    assert.ok(boundary > 0);
    await db.batch(statements.slice(0, boundary).map(sql => db.prepare(sql))); await seed(db);
    const insert = () => db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'reader',?)")
      .bind('https://identity.example.invalid', 'migration-test', now).run();
    await insert();
    const before = (await db.prepare('SELECT * FROM project_grants').all()).results;
    assert.deepEqual(await initialize(db, false), { migrations: ['0010_grant_revision.sql', '0011_analytics_lookup.sql', '0012_workflow_duration.sql', '0013_workflow_failure_reasons.sql'], applied: false });
    await initialize(db, true);
    assert.deepEqual((await db.prepare('SELECT * FROM project_grants').all()).results, before);
    const revision = () => db.prepare("SELECT grant_revision FROM projects WHERE id='sembom'").first('grant_revision');
    assert.equal(await revision(), 0);
    await db.prepare("UPDATE project_grants SET role='owner'").run();
    await db.prepare("UPDATE project_grants SET role='reader'").run();
    assert.equal(await revision(), 2);
    await db.prepare('DELETE FROM project_grants').run(); await insert();
    assert.equal(await revision(), 4);
    assert.deepEqual((await db.prepare('SELECT * FROM project_grants').all()).results, before);
    await db.prepare('UPDATE projects SET grant_revision=9007199254740991').run();
    await assert.rejects(db.prepare('DELETE FROM project_grants').run());
    assert.equal(await revision(), Number.MAX_SAFE_INTEGER);
    assert.equal(await db.prepare('SELECT count(*) FROM project_grants').first('count(*)'), 1);
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    await db.prepare('DROP TRIGGER grant_revision_update').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
  } finally { await mf.dispose(); }
});
