import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { schemaDefinitions, DAY } from '@tallyfin/core';
import { D1Queries } from '../src/query.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { batch, now, prepare, registry, seed, setup, migrationStatements } from './helpers.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'reader' };
const definition = structuredClone(registry); definition.schemaVersion = 2;
Object.assign(definition.workflows[0]!, { failureEvent: 'validation_error', failureReasonProperty: 'error' });
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'admin_changes', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
  await fixture.db.prepare("INSERT INTO project_grants(project_id,issuer,subject,role,created_at) VALUES ('sembom',?,?,'reader',?)").bind(principal.issuer, principal.subject, now).run();
  await fixture.db.prepare("INSERT INTO project_schemas(project_id,version,status,definitions_json,published_at) VALUES ('sembom',2,'active',?,?)")
    .bind(JSON.stringify(schemaDefinitions(definition)), now).run();
});
const query = (at = now, version = 2) => new D1Queries(fixture.db).query(principal,
  { projectId: 'sembom', version, kind: 'workflow', name: 'calculation', from: '2026-10-08', to: '2026-10-09' }, at) as Promise<any>;
function failure(reason?: string) {
  const input = batch(); input.schemaVersion = 2;
  const id = crypto.randomUUID();
  input.events.forEach((e: any) => { e.eventId = crypto.randomUUID(); e.attempt.attemptId = id; });
  input.events[1].name = 'validation_error'; if (reason !== undefined) input.events[1].properties.error = reason;
  return input;
}
test('failure reasons count once under concurrency, terminal-first delivery, duplicates and cleanup', async () => {
  const input = failure('required');
  const terminal = await prepare({ ...input, events: [input.events[1]] }, now, definition);
  await fixture.store.commit(terminal, definition); assert.equal((await query()).failureReasons.measuredFailures, 0);
  const start = await prepare({ ...input, events: [input.events[0]] }, now, definition);
  await Promise.all([fixture.store.commit(start, definition), fixture.store.commit(start, definition)]);
  input.events.forEach((e: any) => { e.eventId = crypto.randomUUID(); }); input.events[1].properties.error = 'range';
  await fixture.store.commit(await prepare(input, now, definition), definition);
  for (const reason of ['range', undefined]) await fixture.store.commit(await prepare(failure(reason), now, definition), definition);
  await fixture.db.prepare('UPDATE workflow_daily_counts SET started_count=started_count+2, failed_count=failed_count+2').run();
  const result = await query();
  assert.deepEqual(result.failureReasons, { property: 'error', measuredFailures: 3, missingReasonFailures: 1, unmeasuredFailures: 2,
    buckets: [{ value: 'range', failedAttempts: 1 }, { value: 'required', failedAttempts: 1 }] });
  assert.deepEqual(result.days[0].failureReasons, result.failureReasons); assert.equal(result.days[1].failureReasons.measuredFailures, 0);
  assert.equal((await query(now, 1)).failureReasons, null);
  await fixture.store.cleanup('sembom', registry.project.timeZone, now + 4 * DAY);
  assert.equal(await fixture.db.prepare('SELECT COUNT(*) AS n FROM workflow_attempts').first('n'), 0);
  assert.deepEqual((await query(now + 4 * DAY)).failureReasons, result.failureReasons);
  await fixture.db.prepare('DELETE FROM project_grants').run(); await assert.rejects(query(), { code: 'forbidden' });
});
test('failure reason migration preserves history, rolls back atomically, constrains counts and initializes once', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}', compatibilityDate: '2026-08-06', d1Databases: { DB: 'failure-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements();
    const boundary = statements.findIndex(sql => sql.startsWith('ALTER TABLE workflow_attempts ADD COLUMN failure_reason_slot'));
    assert.ok(boundary > 0); await db.batch(statements.slice(0, boundary).map(sql => db.prepare(sql))); await seed(db);
    await db.prepare("INSERT INTO workflow_daily_counts(project_id,schema_version,source,cohort_date,workflow_id,dimension_key,started_count,succeeded_count,failed_count,updated_at) VALUES ('sembom',1,'browser','2026-10-08','calculation','[]',3,1,2,0)").run();
    await assert.rejects(db.batch([...statements.slice(boundary).map(sql => db.prepare(sql)), db.prepare('SELECT * FROM missing_reason_table')]));
    assert.deepEqual(await initialize(db, false), { migrations: ['0013_workflow_failure_reasons.sql', '0014_saved_schema_drafts.sql'], applied: false });
    assert.deepEqual(await initialize(db, true), { migrations: ['0013_workflow_failure_reasons.sql', '0014_saved_schema_drafts.sql'], applied: true });
    const row: any = await db.prepare('SELECT * FROM workflow_daily_counts').first();
    assert.equal(row.failed_count, 2); assert.deepEqual(JSON.parse(row.failure_reason_counts_json), Array(33).fill(0));
    for (const value of ['[]', '{}', JSON.stringify(Array(33).fill(-1)), JSON.stringify(Array(33).fill(0.5)), JSON.stringify(Array(33).fill(1))])
      await assert.rejects(db.prepare('UPDATE workflow_daily_counts SET failure_reason_counts_json=?').bind(value).run());
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});
test('concurrent different reasons have one winner and unknown enum slots fail closed', async () => {
  const input = failure('required');
  await fixture.store.commit(await prepare({ ...input, events: [input.events[0]] }, now, definition), definition);
  const other = structuredClone(input); other.events[1].eventId = crypto.randomUUID(); other.events[1].properties.error = 'range';
  const ends = await Promise.all([input, other].map(raw => prepare({ ...raw, events: [raw.events[1]] }, now, definition)));
  await Promise.all(ends.map(end => fixture.store.commit(end, definition)));
  const result = await query(); assert.equal(result.summary.failedAttempts, 1); assert.equal(result.failureReasons.measuredFailures, 1);
  assert.equal(result.failureReasons.buckets.reduce((sum: number, b: any) => sum + b.failedAttempts, 0), 1);
  const counts = Array(33).fill(0); counts[2] = 1;
  await fixture.db.prepare('UPDATE workflow_daily_counts SET failure_reason_counts_json=?').bind(JSON.stringify(counts)).run();
  await assert.rejects(query(), { code: 'storage_unavailable' });
});
