import assert from 'node:assert/strict';
import { test } from 'node:test';
import { D1Maintenance, D1Store } from '../src/index.ts';
import { seed, setup, now } from './helpers.ts';

test('persistent cursor sweeps all projects, includes paused ones and rejects stale progress', async () => {
  const fixture = await setup();
  try {
    for (let i = 1; i <= 7; i++) await seed(fixture.db, `p${i}`);
    await fixture.db.prepare("UPDATE projects SET status='paused' WHERE id='p2'").run();
    const maintenance = new D1Maintenance(fixture.db);
    const first = await maintenance.nextCleanupPage();
    assert.deepEqual(first.projects.map(p => p.id), ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(await maintenance.advanceCleanupCursor(first), true);
    assert.equal(await maintenance.advanceCleanupCursor(first), false);
    const recreated = new D1Maintenance(fixture.db);
    const second = await recreated.nextCleanupPage();
    assert.deepEqual(second.projects.map(p => p.id), ['p6', 'p7', 'sembom']);
    assert.equal(await recreated.advanceCleanupCursor(second), true);
    assert.deepEqual((await recreated.nextCleanupPage()).projects, first.projects);
    // Deleted cursor targets are intentionally not foreign keys.
    await fixture.db.prepare("DELETE FROM project_schemas WHERE project_id='sembom'").run();
    await fixture.db.prepare("DELETE FROM projects WHERE id='sembom'").run();
    assert.deepEqual((await recreated.nextCleanupPage()).projects, first.projects);
    await assert.rejects(recreated.nextCleanupPage(6), /invalid cleanup project limit/);
  } finally { await fixture.mf.dispose(); }
});

test('empty project set wraps cleanly and incomplete DB responses are rejected', async () => {
  const fixture = await setup();
  try {
    await fixture.db.prepare('DELETE FROM project_schemas').run();
    await fixture.db.prepare('DELETE FROM projects').run();
    const store = new D1Maintenance(fixture.db);
    const empty = await store.nextCleanupPage();
    assert.deepEqual(empty.projects, []);
    assert.equal(await store.advanceCleanupCursor(empty), true);
    const broken = { prepare: fixture.db.prepare.bind(fixture.db), batch: async () => [] };
    await assert.rejects(new D1Maintenance(broken).nextCleanupPage());
    await assert.rejects(new D1Store(broken).cleanup('sembom', 'UTC', now));
  } finally { await fixture.mf.dispose(); }
});
