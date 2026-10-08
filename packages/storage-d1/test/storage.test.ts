import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { CollectionError, DAY, planIngest } from '@tallyfin/core';
import { D1Store } from '../src/index.ts';
import type { SqlDatabase, SqlStatement } from '../src/index.ts';
import { batch, now, prepare, registry, seed, setup } from './helpers.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'project_grants', 'project_schemas', 'projects'])
    await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
});
const scalar = async (sql: string) => Number(await fixture.db.prepare(sql).first('value'));
const rows = async (table: string) => (await fixture.db.prepare(`SELECT * FROM ${table}`).all()).results;
const errorCode = (code: string) => (e: unknown) => e instanceof CollectionError && e.code === code;
test('D1 commits receipt, attempts, quota and both aggregates; retransmission is read-only', async () => {
  const prepared = await prepare();
  assert.deepEqual(await fixture.store.commit(prepared, registry), { accepted: 2, duplicates: 0 });
  assert.deepEqual(await fixture.store.commit(prepared, registry), { accepted: 0, duplicates: 2 });
  assert.equal(await scalar('SELECT sum(count) AS value FROM event_daily_counts'), 2);
  assert.equal(await scalar('SELECT new_receipts AS value FROM ingest_daily_usage'), 2);
  assert.equal(await scalar('SELECT ingest_revision AS value FROM projects'), 1);
  const cohort = (await rows('workflow_daily_counts'))[0]!;
  assert.equal(cohort.cohort_date, '2026-10-08'); assert.equal(cohort.started_count, 1); assert.equal(cohort.succeeded_count, 1);
  assert.equal((await rows('event_receipts')).length, 2);
});
test('terminal arriving first is pending until the actual start arrives', async () => {
  const b = batch(); b.events = [b.events[1]];
  await fixture.store.commit(await prepare(b), registry);
  assert.equal((await rows('workflow_daily_counts')).length, 0);
  b.events = [batch().events[0]];
  await fixture.store.commit(await prepare(b), registry);
  const row = (await rows('workflow_daily_counts'))[0]!;
  assert.equal(row.started_count, 1); assert.equal(row.succeeded_count, 1);
});

test('start and terminal in separate batches update the existing cohort exactly once', async () => {
  const input = batch();
  const start = { ...input, events: [input.events[0]] };
  const terminal = { ...input, events: [input.events[1]] };
  assert.deepEqual(await fixture.store.commit(await prepare(start), registry), { accepted: 1, duplicates: 0 });
  assert.deepEqual(await fixture.store.commit(await prepare(terminal), registry), { accepted: 1, duplicates: 0 });
  assert.deepEqual(await fixture.store.commit(await prepare(terminal), registry), { accepted: 0, duplicates: 1 });
  const row = (await rows('workflow_daily_counts'))[0]!;
  assert.equal(row.started_count, 1); assert.equal(row.succeeded_count, 1);
  assert.equal(await scalar('SELECT sum(count) AS value FROM event_daily_counts'), 2);
  assert.equal(await scalar('SELECT new_receipts AS value FROM ingest_daily_usage'), 2);
});

test('a completion-only delta can share a batch with a new complete attempt', async () => {
  const input = batch();
  await fixture.store.commit(await prepare({ ...input, events: [input.events[0]] }), registry);
  const next = batch(); const attemptId = crypto.randomUUID();
  next.events.forEach((event: any) => { event.eventId = crypto.randomUUID(); event.attempt.attemptId = attemptId; });
  next.events.unshift(input.events[1]);
  assert.deepEqual(await fixture.store.commit(await prepare(next), registry), { accepted: 3, duplicates: 0 });
  const row = (await rows('workflow_daily_counts'))[0]!;
  assert.equal(row.started_count, 2); assert.equal(row.succeeded_count, 2);
});
test('new IDs for compatible repeated phases consume quota but do not recount', async () => {
  await fixture.store.commit(await prepare(), registry);
  const b = batch(); b.events[0].eventId = crypto.randomUUID(); b.events[1].eventId = crypto.randomUUID();
  assert.deepEqual(await fixture.store.commit(await prepare(b), registry), { accepted: 0, duplicates: 2 });
  assert.equal(await scalar('SELECT sum(count) AS value FROM event_daily_counts'), 2);
  assert.equal(await scalar('SELECT new_receipts AS value FROM ingest_daily_usage'), 4);
});
test('event conflict and dimension conflict leave the entire batch unchanged', async () => {
  await fixture.store.commit(await prepare(), registry);
  const b = batch(); b.events[0].properties.tool = 'timer';
  await assert.rejects(fixture.store.commit(await prepare(b), registry), errorCode('event_conflict'));
  b.events[0].eventId = crypto.randomUUID();
  await assert.rejects(fixture.store.commit(await prepare(b), registry), errorCode('attempt_conflict'));
  assert.equal(await scalar('SELECT new_receipts AS value FROM ingest_daily_usage'), 2);
  assert.equal(await scalar('SELECT ingest_revision AS value FROM projects'), 1);
});
test('parallel retransmissions and simultaneous distinct batches have one committed count each', async () => {
  const p = await prepare();
  const results = await Promise.all([fixture.store.commit(p, registry), fixture.store.commit(p, registry)]);
  assert.equal(results.reduce((n, r) => n + r.accepted, 0), 2);
  assert.equal(results.reduce((n, r) => n + r.duplicates, 0), 2);
  const inputs = Array.from({ length: 2 }, () => { const b = batch(); b.events = [{ ...b.events[0], eventId: crypto.randomUUID(), name: 'tool_view' }]; delete b.events[0].attempt; return b; });
  await Promise.all(inputs.map(async b => fixture.store.commit(await prepare(b), registry)));
  assert.equal(await scalar('SELECT sum(count) AS value FROM event_daily_counts'), 4);
  assert.equal(await scalar('SELECT new_receipts AS value FROM ingest_daily_usage'), 4);
});
test('UTC daily quota rejects all new rows; same-ID retry still works at quota', async () => {
  await fixture.db.prepare('UPDATE projects SET new_receipts_per_utc_day = 2').run();
  const limited = { ...registry, limits: { ...registry.limits, newReceiptsPerUtcDay: 2 } };
  const p = await prepare(); await fixture.store.commit(p, limited);
  assert.deepEqual(await fixture.store.commit(p, limited), { accepted: 0, duplicates: 2 });
  const b = batch(); b.events[0].eventId = crypto.randomUUID(); b.events[1].eventId = crypto.randomUUID();
  await assert.rejects(fixture.store.commit(await prepare(b), limited), errorCode('quota_exceeded'));
  assert.equal((await rows('event_receipts')).length, 2);
});
test('aggregate overflow rolls back receipt, attempts, quota, latest time and revision', async () => {
  const p = await prepare();
  await fixture.db.prepare(`INSERT INTO event_daily_counts VALUES (?, 1, 'browser', ?, ?, ?, ?, ?)`)
    .bind('sembom', p.events[0]!.eventDate, p.events[0]!.event.name, p.events[0]!.dimensionKey, Number.MAX_SAFE_INTEGER, now - 1000).run();
  await assert.rejects(fixture.store.commit(p, registry), errorCode('storage_unavailable'));
  assert.equal((await rows('event_receipts')).length, 0); assert.equal((await rows('workflow_attempts')).length, 0);
  assert.equal((await rows('ingest_daily_usage')).length, 0);
  assert.equal(await scalar('SELECT ingest_revision AS value FROM projects'), 0);
  assert.equal(await fixture.db.prepare('SELECT latest_received_at FROM projects').first('latest_received_at'), null);
});
test('SQL protects schema immutability, foreign keys and workflow invariant', async () => {
  await assert.rejects(fixture.db.prepare("UPDATE project_schemas SET definitions_json = '{}' ").run());
  await assert.rejects(fixture.db.prepare("UPDATE projects SET time_zone = 'UTC'").run());
  await assert.rejects(fixture.db.prepare("INSERT INTO event_daily_counts VALUES ('other', 1, 'browser', '2026-10-08', 'tool_view', '[]', 1, 0)").run());
  await assert.rejects(fixture.db.prepare("INSERT INTO workflow_daily_counts VALUES ('sembom', 1, 'browser', '2026-10-08', 'calculation', '[]', 1, 2, 0, 0)").run());
  await assert.rejects(fixture.db.prepare("INSERT INTO event_daily_counts VALUES ('sembom', 1, 'browser', '2026-10-08', 'tool_view', '[]', 1.5, 0)").run());
  await assert.rejects(fixture.db.prepare("INSERT INTO workflow_attempts VALUES ('sembom', 'browser', 'attempt', 1, 'calculation', 0, '1970-01-01', '[]', 1, 'success', NULL, 259200000)").run());
});
test('full 20-event batch respects D1 binding limits', async () => {
  const b = batch(); b.events = Array.from({ length: 20 }, () => ({ ...b.events[0], eventId: crypto.randomUUID(), name: 'tool_view' }));
  b.events.forEach((e: any) => { delete e.attempt; });
  assert.deepEqual(await fixture.store.commit(await prepare(b), registry), { accepted: 20, duplicates: 0 });
  assert.equal(await scalar('SELECT sum(count) AS value FROM event_daily_counts'), 20);
});
test('minute admission is shared across instances, saturates, and resets at UTC minute boundary', async () => {
  const second = new D1Store(fixture.db);
  assert.equal(await fixture.store.admit('sembom', now, 2), true);
  assert.equal(await second.admit('sembom', now, 2), true);
  assert.equal(await fixture.store.admit('sembom', now, 2), false);
  assert.equal(await second.admit('sembom', now, 2), false);
  assert.equal(await fixture.store.admit('sembom', now + 60_000, 2), true);
});
test('expiry cleanup is project-scoped and bounded; old receipt does not bypass time validation', async () => {
  await fixture.store.commit(await prepare(), registry); await seed(fixture.db, 'other');
  const otherRegistry = structuredClone(registry); otherRegistry.project.id = 'other';
  await fixture.store.commit(await prepare(batch(), now, otherRegistry), otherRegistry);
  await fixture.store.cleanup('sembom', registry.project.timeZone, now + 4 * DAY, 1);
  assert.equal((await rows('event_receipts')).length, 3);
  await fixture.store.cleanup('sembom', registry.project.timeZone, now + 4 * DAY);
  assert.equal((await rows('event_receipts')).length, 2);
  assert.equal((await rows('workflow_attempts')).length, 1);
  assert.equal(await fixture.db.prepare("SELECT count(*) AS count FROM event_receipts WHERE project_id='sembom'").first('count'), 0);
  await assert.rejects(prepare(batch(), now + 4 * DAY), errorCode('invalid_event'));
  assert.equal((await rows('projects')).length, 2);
});
test('a forced stale snapshot retries the named SQL guard and increments aggregates once', async () => {
  let raced = false;
  const db: SqlDatabase = {
    prepare: query => fixture.db.prepare(query),
    async batch<T>(statements: SqlStatement[]) {
      if (!raced && statements.length > 5) {
        raced = true;
        await fixture.db.prepare('UPDATE projects SET ingest_revision = ingest_revision + 1').run();
      }
      return fixture.db.batch<T>(statements as Parameters<typeof fixture.db.batch>[0]);
    },
  };
  const store = new D1Store(db);
  assert.deepEqual(await store.commit(await prepare(), registry), { accepted: 2, duplicates: 0 });
  assert.equal(raced, true);
  assert.equal(await scalar('SELECT sum(count) AS value FROM event_daily_counts'), 2);
  assert.equal(await scalar('SELECT ingest_revision AS value FROM projects'), 2);
});
test('failure wins once and a conflicting later success leaves committed state intact', async () => {
  const r = structuredClone(registry); r.schemaVersion = 2;
  r.events.push({ ...r.events[2]!, name: 'execution_failure' }); r.workflows[0]!.failureEvent = 'execution_failure';
  await fixture.db.prepare(`INSERT INTO project_schemas VALUES ('sembom', 2, 'active', ?, ?, NULL)`)
    .bind(JSON.stringify({ events: r.events, workflows: r.workflows }), now).run();
  const b = batch(); b.schemaVersion = 2; b.events[1].name = 'execution_failure';
  await fixture.store.commit(await prepare(b, now, r), r);
  const later = batch(); later.schemaVersion = 2; later.events = [later.events[1]]; later.events[0].eventId = crypto.randomUUID();
  await assert.rejects(fixture.store.commit(await prepare(later, now, r), r), errorCode('attempt_conflict'));
  const row = (await rows('workflow_daily_counts'))[0]!;
  assert.equal(row.failed_count, 1); assert.equal(row.succeeded_count, 0);
  assert.equal(await scalar('SELECT new_receipts AS value FROM ingest_daily_usage'), 2);
});
test('changing schema or attempt start with a reused ID conflicts', async () => {
  await fixture.store.commit(await prepare(), registry);
  const r = structuredClone(registry); r.schemaVersion = 2;
  await fixture.db.prepare(`INSERT INTO project_schemas VALUES ('sembom', 2, 'active', ?, ?, NULL)`)
    .bind(JSON.stringify({ events: r.events, workflows: r.workflows }), now).run();
  const b = batch(); b.schemaVersion = 2;
  await assert.rejects(fixture.store.commit(await prepare(b, now, r), r), errorCode('event_conflict'));
  b.events.forEach((e: any) => { e.eventId = crypto.randomUUID(); });
  await assert.rejects(fixture.store.commit(await prepare(b, now, r), r), errorCode('attempt_conflict'));
});
test('expiry is checked on read even if deletion has not run', async () => {
  const p = await prepare(); const expired = p.receivedAt;
  const plan = planIngest(p, { receipts: [{ event_id: p.events[0]!.event.eventId, schema_version: 1,
    payload_hash: 'different', received_at: expired - 2 * DAY, expires_at: expired }], attempts: [], newReceiptsToday: 0 }, 100000);
  assert.equal(plan.accepted, 2); assert.equal(plan.receipts.length, 2);
});
