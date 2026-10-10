import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup } from '../../../packages/storage-d1/test/helpers.ts';
import { restoreFingerprint, restoreIntegrity } from '../restore-fingerprint.ts';

test('restore fingerprints ignore physical row order but detect same-count content, missing indexes and missing protection triggers', async () => {
  const f = await setup();
  try {
    for (const subject of ['first', 'second']) await f.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)')
      .bind('sembom', 'https://identity.example.invalid', subject, 'owner', 1).run();
    await restoreIntegrity(f.db);
    const before = await restoreFingerprint(f.db);
    await f.db.prepare('PRAGMA reverse_unordered_selects=on').run();
    assert.deepEqual(await restoreFingerprint(f.db), before);
    await f.db.prepare("UPDATE projects SET name='changed'").run();
    const changed = await restoreFingerprint(f.db);
    assert.notEqual(changed.fingerprint, before.fingerprint); assert.equal(changed.schemaHash, before.schemaHash);
    assert.deepEqual(changed.tables.map(table => table.rows), before.tables.map(table => table.rows));
    await f.db.prepare('DROP INDEX project_grants_principal').run();
    const lostIndex = await restoreFingerprint(f.db); assert.notEqual(lostIndex.schemaHash, changed.schemaHash);
    await f.db.prepare('DROP TRIGGER immutable_schema').run();
    assert.notEqual((await restoreFingerprint(f.db)).schemaHash, lostIndex.schemaHash);
    await f.db.prepare("CREATE TRIGGER quoted_space BEFORE INSERT ON project_creations BEGIN SELECT RAISE(ABORT,'spaces  matter'); END").run();
    const quoted = await restoreFingerprint(f.db);
    await f.db.prepare('DROP TRIGGER quoted_space').run();
    await f.db.prepare("CREATE TRIGGER quoted_space BEFORE INSERT ON project_creations BEGIN SELECT RAISE(ABORT,'spaces matter'); END").run();
    assert.notEqual((await restoreFingerprint(f.db)).schemaHash, quoted.schemaHash);
  } finally { await f.mf.dispose(); }
});

test('incomplete integrity responses or foreign key violations never pass recovery verification', async () => {
  const statement = { bind() { return this; } };
  for (const result of [[], [{ success: true, results: [] }],
    [{ success: true, results: [{ table: 'broken' }] }, { success: true, results: [{ quick_check: 'ok' }] }],
    [{ success: true, results: [] }, { success: true, results: [{}] }],
    [{ success: true, results: [] }, { success: true, results: [{ quick_check: 'corrupt' }] }]]) {
    const db = { prepare: () => statement, batch: async <T>() => result as unknown as { success: boolean; results: T[]; meta: { changes: number } }[] };
    await assert.rejects(restoreIntegrity(db));
  }
});
