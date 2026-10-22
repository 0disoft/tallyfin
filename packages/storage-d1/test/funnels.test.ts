import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { canonicalJson, DAY, dimensionKey, localDate, parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, schemaDefinitions, validateRegistry } from '@tallyfin/core';
import type { Registry, ServerPrincipal } from '@tallyfin/core';
import { D1Store } from '../src/index.ts';
import type { SqlDatabase, SqlStatement } from '../src/index.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { example, migrationStatements, seed, setup } from './helpers.ts';

let f: Awaited<ReturnType<typeof setup>>;
const r = validateRegistry(example('funnel-registry')), started = Date.parse('2026-10-11T14:59:59Z'), now = started + 10_000;
const publisher: ServerPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-publisher' };
const tables = ['funnel_runs', 'funnel_daily_counts', 'event_receipts', 'event_daily_counts', 'ingest_daily_usage', 'projects'];
const snapshot = async () => Promise.all(tables.map(async table => (await f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
async function register(registry: Registry) {
  if (!await f.db.prepare('SELECT id FROM projects WHERE id=?').bind(registry.project.id).first())
    await f.db.prepare(`INSERT INTO projects (id,name,status,time_zone,allowed_origins_json,requests_per_minute,new_receipts_per_utc_day,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(registry.project.id, registry.project.name, registry.project.status, registry.project.timeZone,
        JSON.stringify(registry.allowedOrigins), registry.limits.requestsPerMinute, registry.limits.newReceiptsPerUtcDay, now).run();
  await f.db.prepare(`INSERT INTO project_schemas VALUES (?,?,'active',?,?,NULL)`)
    .bind(registry.project.id, registry.schemaVersion, canonicalJson(schemaDefinitions(registry)), now).run();
}
const permit = () => f.db.prepare('INSERT INTO project_publishers (project_id,issuer,subject,created_at) VALUES (?,?,?,?)').bind(r.project.id, publisher.issuer, publisher.subject, now).run();
function payload(indices: number[], runId = crypto.randomUUID(), registry = r, overrides: Record<string, unknown> = {}) {
  const source = registry.funnels![0]!.steps[indices[0]!]!.source;
  return { schemaVersion: registry.schemaVersion, source, events: indices.map(index => ({ eventId: crypto.randomUUID(),
    name: registry.funnels![0]!.steps[index]!.eventName, occurredAt: new Date(started + index * 1000).toISOString(), properties: { kind: 'pdf' },
    funnel: { funnelId: registry.funnels![0]!.id, runId, startedAt: new Date(started).toISOString() }, ...overrides })) };
}
async function deliver(input: ReturnType<typeof payload>, registry = r, store = f.store) {
  return input.source === 'browser' ? store.commit(await prepareBatch(parseBatch(JSON.stringify(input)), registry, now), registry) :
    store.commitServer(await prepareServerBatch(parseServerBatch(JSON.stringify(input)), registry, now), registry, publisher);
}
const counts = async (id = r.project.id, version = 1) => (await f.db.prepare(`SELECT step_index,sum(reached_count) AS n FROM funnel_daily_counts
  WHERE project_id=? AND schema_version=? GROUP BY step_index ORDER BY step_index`).bind(id, version).all()).results.map(row => row.n);
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['funnel_runs', 'funnel_daily_counts', 'project_publishers', 'project_grants', 'admin_changes', 'workflow_attempts', 'workflow_daily_counts',
    'event_receipts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'project_schemas', 'projects']) await f.db.prepare(`DELETE FROM ${table}`).run();
  await register(r); await permit();
});

test('real D1 links reverse browser/server arrivals in one start cohort and deduplicates receipt and milestone retries', async () => {
  const id = crypto.randomUUID(), last = payload([3], id);
  assert.deepEqual(await deliver(last), { accepted: 1, duplicates: 0 }); assert.deepEqual(await counts(), []);
  await deliver(payload([0], id)); assert.deepEqual(await counts(), [1]);
  await deliver(payload([2], id)); assert.deepEqual(await counts(), [1]);
  await deliver(payload([1], id)); assert.deepEqual(await counts(), [1, 1, 1, 1]);
  const row = await f.db.prepare('SELECT * FROM funnel_runs').first<any>();
  assert.deepEqual(JSON.parse(row.step_times_json), [started, started + 1000, started + 2000, started + 3000]);
  assert.equal(row.cohort_date, '2026-10-11'); assert.equal(row.expires_at, started + 3 * DAY);
  assert.equal(await f.db.prepare("SELECT count(*) AS n FROM event_daily_counts WHERE source='server' AND event_date='2026-10-12'").first('n'), 2);
  const before = await snapshot(); assert.deepEqual(await deliver(last), { accepted: 0, duplicates: 1 }); assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await deliver(payload([3], id)), { accepted: 0, duplicates: 1 }); assert.deepEqual(await counts(), [1, 1, 1, 1]);
  assert.equal(await f.db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 4);
  assert.equal(await f.db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), 5);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM workflow_attempts').first('n'), 0);
});

test('run, receipt, version and chronological conflicts roll back the entire batch', async () => {
  const id = crypto.randomUUID(), first = payload([0], id); await deliver(first);
  const before = await snapshot(), changedReceipt = structuredClone(first); changedReceipt.events[0]!.properties.kind = 'image';
  await assert.rejects(deliver(changedReceipt), { code: 'event_conflict' });
  await assert.rejects(deliver(payload([1], id, r, { properties: { kind: 'image' } })), { code: 'attempt_conflict' });
  await deliver(payload([2], id)); const staged = await snapshot();
  await assert.rejects(deliver(payload([1], id, r, { occurredAt: new Date(started + 3000).toISOString() })), { code: 'attempt_conflict' });
  assert.deepEqual(await snapshot(), staged);
  const v2 = { ...r, schemaVersion: 2 }; await register(v2);
  await assert.rejects(deliver(payload([1], id, v2), v2), { code: 'attempt_conflict' });
  assert.equal((await f.db.prepare('SELECT * FROM event_receipts').all()).results.length, 2);
  assert.equal((before[0]![0] as any).run_id, id);
});

test('simultaneous browser/server writes and retries use the shared revision guard; publisher revocation remains atomic', async () => {
  const id = crypto.randomUUID(), start = payload([0], id), end = payload([3], id);
  const results = await Promise.all([deliver(start), deliver(end), deliver(end)]);
  assert.equal(results.reduce((sum, result) => sum + result.accepted, 0), 2); assert.deepEqual(await counts(), [1]);
  await deliver(payload([1], id));
  const before = await snapshot(); let calls = 0;
  const revoked = new D1Store({ prepare: query => f.db.prepare(query), async batch<T>(statements: SqlStatement[]) {
    if (++calls === 2) await f.db.prepare('DELETE FROM project_publishers').run();
    return f.db.batch<T>(statements as Parameters<typeof f.db.batch>[0]);
  } });
  await assert.rejects(deliver(payload([2], id), r, revoked), { code: 'forbidden' }); assert.deepEqual(await snapshot(), before);
  await assert.rejects(deliver(end), { code: 'forbidden' });
  const other = { ...r, project: { ...r.project, id: 'other' } }; await register(other);
  await deliver(payload([0], id, other), other); assert.deepEqual(await counts('other'), [1]); assert.deepEqual(await counts(), [1, 1]);
});

test('counter overflow and SQL timestamp/order guards cannot leave receipts, quota or run state partially written', async () => {
  await deliver(payload([0]));
  await f.db.prepare('UPDATE funnel_daily_counts SET reached_count=? WHERE step_index=0').bind(Number.MAX_SAFE_INTEGER).run();
  const before = await snapshot(); await assert.rejects(deliver(payload([0])), { code: 'storage_unavailable' }); assert.deepEqual(await snapshot(), before);
  await assert.rejects(f.db.prepare('UPDATE funnel_runs SET step_times_json=?').bind(JSON.stringify([started, started - 1, null, null])).run());
  await assert.rejects(f.db.prepare('UPDATE funnel_runs SET step_times_json=?').bind(JSON.stringify([started, true, null, null])).run());
  await assert.rejects(f.db.prepare(`INSERT INTO funnel_daily_counts VALUES (?,1,'2026-10-11','conversion','[]',3,1,?)`).bind(r.project.id, now).run());
});

test('twenty delayed starts can unlock ten steps in twenty dimension buckets within the 100-bind and 50-statement budgets', async () => {
  const kinds = Array.from({ length: 20 }, (_, index) => `bucket_${index}`), full = structuredClone(r); full.schemaVersion = 2;
  for (let index = 4; index < 10; index++) {
    full.events.push({ ...structuredClone(full.events[2]!), name: `stage_${index}`, source: 'server' });
    full.funnels![0]!.steps.push({ eventName: `stage_${index}`, source: 'server' });
  }
  full.events.forEach(event => { event.properties.kind = { type: 'enum', required: true, purpose: 'Reviewed bucket', values: kinds }; });
  validateRegistry(full); await register(full);
  const inputs = kinds.map(kind => payload([0], crypto.randomUUID(), full, { properties: { kind } }));
  await f.db.batch(inputs.map(input => f.db.prepare('INSERT INTO funnel_runs VALUES (?,?,?,?,?,?,?,?,?)').bind(full.project.id,
    input.events[0]!.funnel.runId, 2, 'conversion', started, '2026-10-11', dimensionKey(input.events[0]!.properties),
    JSON.stringify(Array.from({ length: 10 }, (_, index) => index === 0 ? null : started + index * 1000)), started + 3 * DAY)));
  let queries = 0;
  const bounded: SqlDatabase = { prepare(query) { const statement = f.db.prepare(query); return { bind(...values) {
    assert.ok(values.length <= 100); return statement.bind(...values);
  } }; }, async batch<T>(statements: SqlStatement[]) {
    queries += statements.length; return f.db.batch<T>(statements as Parameters<typeof f.db.batch>[0]);
  } };
  const input = { ...inputs[0]!, events: inputs.flatMap(input => input.events) };
  assert.deepEqual(await deliver(input, full, new D1Store(bounded)), { accepted: 20, duplicates: 0 });
  assert.ok(queries <= 50, `observed statements: ${queries}`); assert.deepEqual(await counts(full.project.id, 2), Array(10).fill(20));
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM funnel_daily_counts').first('n'), 200);
});

test('cleanup deletes bounded expired linkage and old cohorts only in the selected project', async () => {
  const foreign = { ...r, project: { ...r.project, id: 'other' } }; await register(foreign);
  const today = localDate(now, r.project.timeZone), cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10);
  const oldDate = new Date(Date.parse(`${cutoff}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  for (const [project, time] of [[r.project.id, now - 3 * DAY], [r.project.id, now - 3 * DAY + 1], [foreign.project.id, now - 3 * DAY]] as const)
    await f.db.prepare('INSERT INTO funnel_runs VALUES (?,?,?,?,?,?,?,?,?)').bind(project, crypto.randomUUID(), 1, 'conversion', time,
      localDate(time, r.project.timeZone), '[]', JSON.stringify([time, null, null, null]), time + 3 * DAY).run();
  for (const [project, date] of [[r.project.id, oldDate], [r.project.id, cutoff], [foreign.project.id, oldDate]])
    await f.db.prepare('INSERT INTO funnel_daily_counts VALUES (?,1,?,\'conversion\',\'[]\',0,1,?)').bind(project!, date!, now).run();
  await f.store.cleanup(r.project.id, r.project.timeZone, now, 1);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM funnel_runs WHERE project_id=?').bind(r.project.id).first('n'), 1);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM funnel_runs WHERE project_id=?').bind(foreign.project.id).first('n'), 1);
  assert.equal(await f.db.prepare('SELECT cohort_date FROM funnel_daily_counts WHERE project_id=?').bind(r.project.id).first('cohort_date'), cutoff);
});

test('0007 adds only empty funnel tables/guards and rejects missing guards on subsequent initialization', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}', d1Databases: { DB: 'funnel-upgrade' } });
  try {
    const db = await mf.getD1Database('DB'), statements = migrationStatements(), boundary = statements.findIndex(sql => sql.startsWith('CREATE TABLE funnel_runs'));
    assert.ok(boundary > 0); for (const sql of statements.slice(0, boundary)) await db.prepare(sql).run(); await seed(db);
    const before = (await db.prepare('SELECT * FROM projects').all()).results;
    assert.deepEqual(await initialize(db, false), { migrations: ['0007_task_funnels.sql', '0008_publisher_history.sql', '0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql', '0012_workflow_duration.sql', '0013_workflow_failure_reasons.sql'], applied: false });
    assert.deepEqual(await initialize(db, true), { migrations: ['0007_task_funnels.sql', '0008_publisher_history.sql', '0009_publisher_generations.sql', '0010_grant_revision.sql', '0011_analytics_lookup.sql', '0012_workflow_duration.sql', '0013_workflow_failure_reasons.sql'], applied: true });
    assert.deepEqual((await db.prepare('SELECT * FROM projects').all()).results, before.map(row => ({ ...row, grant_revision: 0 })));
    assert.equal(await db.prepare('SELECT count(*) AS n FROM funnel_runs').first('n'), 0);
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    await db.prepare('DROP TRIGGER funnel_daily_update').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
  } finally { await mf.dispose(); }
});
