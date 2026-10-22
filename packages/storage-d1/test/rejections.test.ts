import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY, rejectionRange } from '@tallyfin/core';
import { D1Store } from '../src/index.ts';
import { collectionRejections } from '../src/rejections.ts';
import { initialize } from '../../../tools/provision/local.ts';
import { migrationStatements, setup, now, seed } from './helpers.ts';
import { Miniflare } from 'miniflare';

const principal = { issuer: 'https://identity.example.invalid', subject: 'rejection-test' };
const from = '2026-10-08';
async function grant(db: Awaited<ReturnType<typeof setup>>['db']) {
  await db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', principal.issuer, principal.subject, 'reader', now).run();
}
test('migration preserves existing admission counters, upgrades once and applies from an empty DB', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response();}}', compatibilityDate: '2026-08-06', d1Databases: { DB: 'rejection-migration' } });
  try {
    const db = await mf.getD1Database('DB');
    for (const statement of migrationStatements().filter(sql => !sql.startsWith('ALTER TABLE ingest_minute_usage'))) await db.prepare(statement).run();
    await seed(db);
    await db.prepare('INSERT INTO ingest_minute_usage VALUES (?,?,?)').bind('sembom', Math.floor(now / 60_000) * 60_000, 5).run();
    assert.deepEqual(await initialize(db, false), { migrations: ['0004_collection_rejections.sql'], applied: false });
    assert.deepEqual(await initialize(db, true), { migrations: ['0004_collection_rejections.sql'], applied: true });
    assert.deepEqual(await initialize(db, true), { migrations: [], applied: false });
    assert.equal(await db.prepare('SELECT request_count FROM ingest_minute_usage').first('request_count'), 5);
    assert.equal(await db.prepare('SELECT rejections_json FROM ingest_minute_usage').first('rejections_json'), '{}');
    await assert.rejects(db.prepare("UPDATE ingest_minute_usage SET rejections_json='[]'").run());
  } finally { await mf.dispose(); }
});
test('minute quota uses one existing admission statement and other failures update only an existing admitted minute', async () => {
  const f = await setup();
  try {
    await f.db.prepare('UPDATE projects SET requests_per_minute=2').run();
    let statements = 0;
    const store = new D1Store({ prepare: sql => f.db.prepare(sql), batch: async <T>(queries: Parameters<typeof f.store.db.batch>[0]) => {
      statements += queries.length; return f.db.batch<T>(queries as Parameters<typeof f.db.batch>[0]);
    } });
    for (const expected of [true, true, false, false]) assert.equal(await store.admit('sembom', now, 2), expected);
    assert.equal(statements, 4);
    await store.recordRejection('sembom', now + 1, 'origin_denied');
    const json = JSON.parse(await f.db.prepare('SELECT rejections_json FROM ingest_minute_usage').first<string>('rejections_json') as string);
    assert.deepEqual(json, { minute_limit: { count: 2, lastRejectedAt: now }, origin_denied: { count: 1, lastRejectedAt: now + 1 } });
    await assert.rejects(store.recordRejection('sembom', now + 60_000, 'invalid_event'));
    await assert.rejects(store.recordRejection('sembom', now, 'minute_limit'));
    await assert.rejects(store.recordRejection('sembom', now, 'payload-secret' as 'invalid_event'));
    await assert.rejects(store.admit('sembom', now, 601));
  } finally { await f.mf.dispose(); }
});
test('admission never decreases on limit changes and concurrent rejection writes preserve counts and the latest timestamp', async () => {
  const f = await setup();
  try {
    await f.db.prepare('UPDATE projects SET requests_per_minute=2').run();
    assert.equal(await f.store.admit('sembom', now, 2), true);
    assert.equal(await f.store.admit('sembom', now, 2), true);
    await f.db.prepare('UPDATE projects SET requests_per_minute=1').run();
    assert.equal(await f.store.admit('sembom', now, 1), false);
    await f.db.prepare('UPDATE projects SET requests_per_minute=2').run();
    assert.equal(await f.store.admit('sembom', now, 2), false);
    assert.equal(await f.db.prepare('SELECT request_count FROM ingest_minute_usage').first('request_count'), 4);
    await Promise.all(Array.from({ length: 12 }, (_, index) => f.store.recordRejection('sembom', now + 12 - index, 'invalid_event')));
    const json = JSON.parse(await f.db.prepare('SELECT rejections_json FROM ingest_minute_usage').first<string>('rejections_json') as string);
    assert.equal(json.invalid_event.count, 12); assert.equal(json.invalid_event.lastRejectedAt, now + 12);
    assert.equal(json.minute_limit.count, 2);
  } finally { await f.mf.dispose(); }
});
test('project-scoped UTC rejection summary merges multiple minutes and quota scopes, with null empty days', async () => {
  const f = await setup();
  try {
    await grant(f.db); await seed(f.db, 'other');
    await f.db.prepare('UPDATE projects SET requests_per_minute=1').run();
    await f.store.admit('sembom', now, 1); await f.store.recordRejection('sembom', now, 'daily_limit');
    await f.store.admit('sembom', now + 1, 1);
    await f.store.admit('sembom', now + 60_000, 1); await f.store.recordRejection('sembom', now + 60_000, 'origin_denied');
    await f.store.admit('other', now, 1); await f.store.recordRejection('other', now, 'invalid_event');
    const result = await collectionRejections(f.db, principal, 'sembom', from, '2026-10-09', now + DAY);
    assert.equal(result.summary.rejectedRequests, 3); assert.equal(result.summary.lastRejectedAt, new Date(now + 60_000).toISOString());
    assert.equal(result.summary.reasons.find(row => row.reason === 'minute_limit')!.count, 1);
    assert.equal(result.summary.reasons.find(row => row.reason === 'daily_limit')!.count, 1);
    assert.equal(result.days[1]!.rejectedRequests, 0); assert.equal(result.days[1]!.lastRejectedAt, null);
    assert.equal(result.meta.coverage, 'best-effort');
    await assert.rejects(collectionRejections(f.db, principal, 'other', from, from, now), (error: unknown) => (error as { code: string }).code === 'forbidden');
    await f.db.prepare('DELETE FROM project_grants').run();
    await assert.rejects(collectionRejections(f.db, principal, 'sembom', from, from, now));
  } finally { await f.mf.dispose(); }
});
test('rejection range and persisted data fail closed on invalid dates, unsafe counts, unknown reasons or invalid timestamps', async () => {
  assert.throws(() => rejectionRange('sembom', '2026-10-01', from, now));
  assert.throws(() => rejectionRange('sembom', '2026-02-30', from, now));
  assert.throws(() => rejectionRange('sembom', from, '2026-10-09', now));
  const f = await setup();
  try {
    await grant(f.db); await f.store.admit('sembom', now, 1);
    for (const json of [{ unexpected: { count: 1, lastRejectedAt: now } }, { origin_denied: { count: 0, lastRejectedAt: now } },
      { origin_denied: { count: 601, lastRejectedAt: now } }, { minute_limit: { count: 1.5, lastRejectedAt: now } },
      { origin_denied: { count: 1, lastRejectedAt: now + 60_000 } }]) {
      await f.db.prepare('UPDATE ingest_minute_usage SET rejections_json=?').bind(JSON.stringify(json)).run();
      await assert.rejects(collectionRejections(f.db, principal, 'sembom', from, from, now));
    }
  } finally { await f.mf.dispose(); }
});
test('cleanup retains only rejection minutes within seven UTC dates, is bounded and excludes other projects', async () => {
  const f = await setup();
  try {
    await seed(f.db, 'other');
    for (const project of ['sembom', 'other']) {
      await f.store.admit(project, now - 6 * DAY, 1); await f.store.recordRejection(project, now - 6 * DAY, 'invalid_event');
      await f.store.admit(project, now - 7 * DAY, 1); await f.store.recordRejection(project, now - 7 * DAY, 'invalid_event');
      await f.store.admit(project, now - 5 * 60_000, 1);
    }
    await f.store.cleanup('sembom', 'Asia/Seoul', now, 1);
    assert.equal(await f.db.prepare("SELECT count(*) FROM ingest_minute_usage WHERE project_id='sembom'").first('count(*)'), 2);
    await f.store.cleanup('sembom', 'Asia/Seoul', now);
    assert.equal(await f.db.prepare("SELECT count(*) FROM ingest_minute_usage WHERE project_id='sembom'").first('count(*)'), 1);
    assert.equal(await f.db.prepare("SELECT count(*) FROM ingest_minute_usage WHERE project_id='other'").first('count(*)'), 3);
  } finally { await f.mf.dispose(); }
});

test('admission uses the transactional current limit after a caller has read stale settings', async () => {
  const f = await setup();
  try {
    const old = await f.store.loadProject('sembom');
    await f.db.prepare('UPDATE projects SET requests_per_minute=1').run();
    assert.equal(await f.store.admit('sembom', now, old!.limits.requestsPerMinute), true);
    assert.equal(await f.store.admit('sembom', now, old!.limits.requestsPerMinute), false);
    await f.db.prepare('UPDATE projects SET requests_per_minute=3').run();
    assert.equal(await f.store.admit('sembom', now, 1), true);
    assert.equal(await f.store.admit('sembom', now, 1), false);
    const reasons = JSON.parse(await f.db.prepare('SELECT rejections_json FROM ingest_minute_usage').first<string>('rejections_json') as string);
    assert.equal(reasons.minute_limit.count, 2);
  } finally { await f.mf.dispose(); }
});
