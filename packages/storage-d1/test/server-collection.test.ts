import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare } from 'miniflare';
import { DAY, parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, validateRegistry } from '@tallyfin/core';
import { D1Store } from '../src/index.ts';
import type { SqlDatabase, SqlStatement } from '../src/index.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { batch, example, migrationStatements, now, prepare, registry as browserRegistry, seed, setup } from './helpers.ts';

let f: Awaited<ReturnType<typeof setup>>;
const publisher = { issuer: 'https://machine.example.invalid', subject: 'test-service' };
const input = () => example('server-batch');
const definition = { name: 'job_finished', label: 'Job finished', source: 'server', properties: {
  outcome: { type: 'enum', values: ['success', 'failure'], required: true, purpose: 'Job result category' },
  retried: { type: 'boolean', required: false, purpose: 'Retry category' },
} };
const registry = validateRegistry({ ...structuredClone(browserRegistry), events: [...browserRegistry.events, definition] });
const server = (value = input(), at = now, r = registry) => prepareServerBatch(parseServerBatch(JSON.stringify(value)), r, at);
const rows = (table: string) => f.db.prepare(`SELECT * FROM ${table}`).all();
const scalar = (query: string) => f.db.prepare(query).first<number>('n');
const permit = () => f.db.prepare('INSERT INTO project_publishers VALUES (?,?,?,?)').bind('sembom', publisher.issuer, publisher.subject, now).run();

before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['project_publishers', 'project_grants', 'admin_changes', 'workflow_daily_counts', 'event_daily_counts',
    'workflow_attempts', 'event_receipts', 'ingest_daily_usage', 'ingest_minute_usage', 'project_schemas'])
    await f.db.prepare(`DELETE FROM ${table}`).run();
  await f.db.prepare("UPDATE projects SET status='active', ingest_revision=0, latest_received_at=NULL, new_receipts_per_utc_day=100000").run();
  await f.db.prepare("INSERT INTO project_schemas VALUES ('sembom',1,'active',?,?,NULL)")
    .bind(JSON.stringify({ events: registry.events, workflows: registry.workflows }), now).run();
});

test('publish permission is explicit and project/issuer/subject scoped; administrator ownership never implies it', async () => {
  await f.db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'owner',?)").bind(publisher.issuer, publisher.subject, now).run();
  await assert.rejects(f.store.publisherAccess('sembom', publisher), { code: 'forbidden' });
  await assert.rejects(f.store.commitServer(await server(), registry, publisher), { code: 'forbidden' });
  assert.equal(await scalar('SELECT count(*) AS n FROM event_receipts'), 0);
  await permit(); await f.store.publisherAccess('sembom', publisher);
  for (const [id, principal] of [['other', publisher], ['sembom', { ...publisher, subject: 'other' }],
    ['sembom', { ...publisher, issuer: 'https://other.example.invalid' }], ['sembom', { ...publisher, issuer: 'http://unsafe.invalid' }]] as const)
    await assert.rejects(f.store.publisherAccess(id, principal), { code: 'forbidden' });
});

test('browser/server receipts with the same ID stay isolated, retry is read-only, and server writes create no workflow state', async () => {
  await permit();
  const browser = batch(); browser.events = [{ ...browser.events[0], eventId: input().events[0].eventId, name: 'tool_view' }];
  delete browser.events[0].attempt;
  assert.deepEqual(await f.store.commit(await prepareBatch(parseBatch(JSON.stringify(browser)), registry, now), registry), { accepted: 1, duplicates: 0 });
  assert.deepEqual(await f.store.commitServer(await server(), registry, publisher), { accepted: 1, duplicates: 0 });
  const before = (await rows('projects')).results;
  assert.deepEqual(await f.store.commitServer(await server(input(), now + 1000), registry, publisher), { accepted: 0, duplicates: 1 });
  assert.deepEqual((await rows('projects')).results, before);
  assert.deepEqual((await rows('event_receipts')).results.map(r => r.source).sort(), ['browser', 'server']);
  assert.equal(await scalar('SELECT new_receipts AS n FROM ingest_daily_usage'), 2);
  assert.equal(await scalar('SELECT sum(count) AS n FROM event_daily_counts'), 2);
  assert.equal(await scalar("SELECT sum(count) AS n FROM event_daily_counts WHERE source='server'"), 1);
  assert.equal(await scalar('SELECT count(*) AS n FROM workflow_attempts'), 0);
  assert.equal(await scalar('SELECT count(*) AS n FROM workflow_daily_counts'), 0);
  await assert.rejects(f.store.commit(await server() as any, registry), { code: 'invalid_request' });
  await assert.rejects(f.store.commitServer(await prepare(), registry, publisher), { code: 'invalid_request' });
  const malformed = await server(); (malformed.events[0]!.event as any).attempt = undefined;
  await assert.rejects(f.store.commitServer(malformed, registry, publisher), { code: 'invalid_event' });
});

test('content conflict rolls back the whole server batch and UTC daily budget is shared across sources', async () => {
  await permit();
  await f.db.prepare('UPDATE projects SET new_receipts_per_utc_day=1').run();
  const limited = (await f.store.loadRegistry('sembom', 1))!;
  await f.store.commitServer(await server(input(), now, limited), limited, publisher);
  const conflict = input(); conflict.events[0].properties.outcome = 'failure';
  await assert.rejects(f.store.commitServer(await server(conflict, now, limited), limited, publisher), { code: 'event_conflict' });
  await assert.rejects(f.store.commit(await prepareBatch(parseBatch(JSON.stringify(batch())), limited, now), limited), { code: 'quota_exceeded' });
  assert.deepEqual(await f.store.commitServer(await server(input(), now, limited), limited, publisher), { accepted: 0, duplicates: 1 });
  assert.equal(await scalar('SELECT count(*) AS n FROM event_receipts'), 1);
  assert.equal(await scalar('SELECT new_receipts AS n FROM ingest_daily_usage'), 1);
});

test('revocation between read and write aborts every mutation; even exact retries require current permission', async () => {
  await permit(); let calls = 0;
  const wrapped: SqlDatabase = {
    prepare: query => f.db.prepare(query),
    async batch<T>(statements: SqlStatement[]) {
      if (++calls === 2) await f.db.prepare('DELETE FROM project_publishers').run();
      return f.db.batch<T>(statements as Parameters<typeof f.db.batch>[0]);
    },
  };
  await assert.rejects(new D1Store(wrapped).commitServer(await server(), registry, publisher), { code: 'forbidden' });
  assert.equal(calls, 3);
  assert.equal(await scalar('SELECT count(*) AS n FROM event_receipts'), 0);
  assert.equal(await scalar('SELECT count(*) AS n FROM event_daily_counts'), 0);
  assert.equal(await scalar('SELECT count(*) AS n FROM ingest_daily_usage'), 0);
  assert.equal(await scalar('SELECT ingest_revision AS n FROM projects'), 0);
  assert.equal(await scalar('SELECT latest_received_at AS n FROM projects'), null);
  await permit(); await f.store.commitServer(await server(), registry, publisher);
  await f.db.prepare('DELETE FROM project_publishers').run();
  await assert.rejects(f.store.commitServer(await server(), registry, publisher), { code: 'forbidden' });
  assert.equal(await scalar('SELECT count(*) AS n FROM event_receipts'), 1);
});

test('parallel 20-event deliveries count once and aggregate failure leaves receipts/quota/revision unchanged', async () => {
  await permit(); const value = input();
  value.events = Array.from({ length: 20 }, () => ({ ...value.events[0], eventId: crypto.randomUUID() }));
  const prepared = await server(value);
  const results = await Promise.all([f.store.commitServer(prepared, registry, publisher), f.store.commitServer(prepared, registry, publisher)]);
  assert.equal(results.reduce((n, result) => n + result.accepted, 0), 20);
  assert.equal(results.reduce((n, result) => n + result.duplicates, 0), 20);
  assert.equal(await scalar('SELECT count(*) AS n FROM event_receipts'), 20);
  await f.db.prepare("UPDATE event_daily_counts SET count=9007199254740991 WHERE source='server'").run();
  const newer = input(); newer.events[0].eventId = crypto.randomUUID();
  await assert.rejects(f.store.commitServer(await server(newer), registry, publisher), { code: 'storage_unavailable' });
  assert.equal(await scalar('SELECT count(*) AS n FROM event_receipts'), 20);
  assert.equal(await scalar('SELECT new_receipts AS n FROM ingest_daily_usage'), 20);
  assert.equal(await scalar('SELECT ingest_revision AS n FROM projects'), 1);
});

test('retention cleans server receipts/counts with the existing bounded project-scoped cleanup', async () => {
  await permit(); await f.store.commitServer(await server(), registry, publisher);
  await f.db.prepare("INSERT INTO event_daily_counts VALUES ('sembom',1,'server','2020-01-01','job_finished','[]',1,?)").bind(now).run();
  await f.store.cleanup('sembom', registry.project.timeZone, now + 3 * DAY, 1);
  assert.equal(await scalar("SELECT count(*) AS n FROM event_receipts WHERE source='server'"), 0);
  assert.equal(await scalar("SELECT count(*) AS n FROM event_daily_counts WHERE event_date='2020-01-01'"), 0);
  assert.equal(await scalar("SELECT count(*) AS n FROM event_daily_counts WHERE source='server'"), 1);
  assert.equal(await scalar('SELECT count(*) AS n FROM project_publishers'), 1);
});

test('0006 upgrades atomically without data/authority backfill, retains indexes and refuses partial initialization', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response(null)}}',
    compatibilityDate: '2026-08-06', d1Databases: { DB: 'server-migration' } });
  try {
    const db = await mf.getD1Database('DB'), sql = migrationStatements(), start = sql.findIndex(s => s.startsWith('CREATE TABLE event_receipts_next'));
    assert.ok(start > 0);
    await db.batch(sql.slice(0, start).map(s => db.prepare(s))); await seed(db);
    await new D1Store(db).commit(await prepare(), browserRegistry);
    await db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'owner',?)").bind(publisher.issuer, publisher.subject, now).run();
    const tables = ['projects', 'project_grants', 'project_schemas', 'event_receipts', 'event_daily_counts', 'workflow_attempts',
      'workflow_daily_counts', 'ingest_daily_usage'];
    const snapshot = async () => Promise.all(tables.map(async table => (await db.prepare(`SELECT * FROM ${table}`).all()).results));
    const before = await snapshot();
    await assert.rejects(db.batch([...sql.slice(start).map(s => db.prepare(s)),
      db.prepare("INSERT INTO event_daily_counts VALUES ('sembom',1,'server','2026-10-09','job_finished','[]',-1,0)")]));
    assert.deepEqual(await snapshot(), before);
    assert.equal(await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('project_publishers','event_receipts_next','event_daily_counts_next')").first('n'), 0);
    assert.deepEqual(await initialize(db, false), { migrations: ['0006_server_collection.sql', '0007_task_funnels.sql'], applied: false });
    assert.deepEqual(await initialize(db, true), { migrations: ['0006_server_collection.sql', '0007_task_funnels.sql'], applied: true });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.equal(await db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 0);
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    assert.equal(await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name IN ('event_receipts_expiry','event_daily_counts_retention')").first('n'), 2);
    await assert.rejects(db.prepare("INSERT INTO event_receipts VALUES ('sembom','other','bad',1,?,0,172800000)").bind('a'.repeat(64)).run());
    await db.prepare('DROP TABLE project_publishers').run();
    await assert.rejects(initialize(db, true), { code: 'partial_database' });
  } finally { await mf.dispose(); }
});
