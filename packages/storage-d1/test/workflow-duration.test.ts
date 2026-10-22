import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { schemaDefinitions, DAY } from '@tallyfin/core';
import { D1Queries } from '../src/query.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { batch, now, prepare, registry, seed, setup, migrationStatements } from './helpers.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'reader' };
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'admin_changes', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
  await fixture.db.prepare("INSERT INTO project_grants(project_id,issuer,subject,role,created_at) VALUES ('sembom',?,?,'reader',?)").bind(principal.issuer, principal.subject, now).run();
});
const query = (at = now, version = 1) => new D1Queries(fixture.db).query(principal,
  { projectId: 'sembom', version, kind: 'workflow', name: 'calculation', from: '2026-10-08', to: '2026-10-09' }, at) as Promise<any>;
const totals = async () => JSON.parse((await fixture.db.prepare('SELECT duration_counts_json FROM workflow_daily_counts').first<string>('duration_counts_json'))!);

test('parallel commits, new event IDs and terminal-first batches count one duration and retain it after attempt cleanup', async () => {
  const input = batch(); const end = await prepare({ ...input, events: [input.events[1]] });
  await fixture.store.commit(end, registry); assert.equal((await query()).duration.measuredAttempts, 0);
  const start = await prepare({ ...input, events: [input.events[0]] });
  await Promise.all([fixture.store.commit(start, registry), fixture.store.commit(start, registry)]);
  const again = batch(); again.events.forEach((event: any) => { event.eventId = crypto.randomUUID(); });
  await fixture.store.commit(await prepare(again), registry);
  assert.equal((await totals()).reduce((sum: number, n: number) => sum + n, 0), 1);
  const result = await query();
  assert.equal(result.duration.measuredAttempts, 1); assert.equal(result.duration.unmeasuredAttempts, 0);
  assert.equal(result.duration.buckets[2].succeededAttempts, 1);
  assert.equal(result.days[0].duration.measuredAttempts, 1); assert.equal(result.days[1].duration.measuredAttempts, 0);
  await fixture.store.cleanup('sembom', registry.project.timeZone, now + 4 * DAY);
  assert.equal(await fixture.db.prepare('SELECT COUNT(*) AS n FROM workflow_attempts').first('n'), 0);
  assert.equal((await query(now + 4 * DAY)).duration.measuredAttempts, 1);
  await fixture.db.prepare('DELETE FROM project_grants').run();
  await assert.rejects(query(), { code: 'forbidden' });
});

test('successful and failed durations remain distinct with mixed measured and historical completions', async () => {
  const definition = structuredClone(registry); definition.schemaVersion = 2; definition.workflows[0]!.failureEvent = 'validation_error';
  await fixture.db.prepare("INSERT INTO project_schemas(project_id,version,status,definitions_json,published_at) VALUES ('sembom',2,'active',?,?)")
    .bind(JSON.stringify(schemaDefinitions(definition)), now).run();
  const input = batch(); input.schemaVersion = 2; input.events[1].name = 'validation_error';
  await fixture.store.commit(await prepare(input, now, definition), definition);
  await fixture.db.prepare('UPDATE workflow_daily_counts SET started_count=started_count+3, succeeded_count=succeeded_count+2, failed_count=failed_count+1').run();
  const result = await query(now, 2);
  assert.equal(result.duration.buckets[2].failedAttempts, 1);
  assert.equal(result.duration.measuredAttempts, 1); assert.equal(result.duration.unmeasuredAttempts, 3);
  assert.equal((await query()).duration.measuredAttempts, 0); // Version isolation.
  for (const value of ['[]', '{}', '[null,0,0,0,0,0,0,0,0,0,0,0]', '[-1,0,0,0,0,0,0,0,0,0,0,0]', '[0,0,0,0,0,99,0,0,0,0,0,0]'])
    await assert.rejects(fixture.db.prepare('UPDATE workflow_daily_counts SET duration_counts_json=?').bind(value).run());
});

test('duration migration preserves existing completions as unmeasured, rolls back atomically and is detected on repeat initialization', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}', compatibilityDate: '2026-08-06', d1Databases: { DB: 'duration-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements();
    const boundary = statements.findIndex(sql => sql.startsWith('ALTER TABLE workflow_daily_counts ADD COLUMN duration_counts_json'));
    assert.ok(boundary > 0); await db.batch(statements.slice(0, boundary).map(sql => db.prepare(sql))); await seed(db);
    await db.prepare("INSERT INTO workflow_daily_counts VALUES ('sembom',1,'browser','2026-10-08','calculation','[]',3,2,1,0)").run();
    await assert.rejects(db.batch([...statements.slice(boundary).map(sql => db.prepare(sql)), db.prepare('SELECT * FROM missing_duration_table')]));
    assert.deepEqual(await initialize(db, false), { migrations: ['0012_workflow_duration.sql'], applied: false });
    assert.deepEqual(await initialize(db, true), { migrations: ['0012_workflow_duration.sql'], applied: true });
    const row: any = await db.prepare('SELECT * FROM workflow_daily_counts').first();
    assert.equal(row.succeeded_count, 2); assert.equal(row.failed_count, 1); assert.deepEqual(JSON.parse(row.duration_counts_json), Array(12).fill(0));
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});
