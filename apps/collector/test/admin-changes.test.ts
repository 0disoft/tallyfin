import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { DAY } from '@tallyfin/core';
import type { AdminChangeDetail, AdminChangePage, AdminPrincipal } from '@tallyfin/core';
import { adminChangeStatement, D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '@tallyfin/storage-d1';
import { setup, seed, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let f: Awaited<ReturnType<typeof setup>>;
const owner = { issuer: 'https://identity.example.invalid', subject: 'history-owner' };
const target = { issuer: owner.issuer, subject: 'history-target' };
before(async () => { f = await setup(); await seed(f.db, 'other'); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  await f.db.prepare('DELETE FROM admin_changes').run(); await f.db.prepare('DELETE FROM project_grants').run();
  await grant(owner);
});
const grant = async (principal: AdminPrincipal, role = 'owner', project = 'sembom') => {
  await f.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind(project, principal.issuer, principal.subject, role, now).run();
};
const record = (change: AdminChangeDetail, at = now, actor: AdminPrincipal | null = owner, project = 'sembom') =>
  f.db.batch([adminChangeStatement(f.db, project, actor, change, at, 'always')]);
function request(suffix = '', method = 'GET', project = 'sembom') {
  return new Request(`https://collector.example.invalid/v1/projects/${project}/changes${suffix}`, {
    method, headers: { Authorization: 'Bearer not-a-credential' } });
}
function handler(principal = owner, store = new D1Queries(f.db)) {
  return createCollector(f.store, { now: () => now, admin: { store, verifyBearer: async () => principal } });
}
async function read(suffix = '', principal = owner): Promise<AdminChangePage> {
  const response = await handler(principal)(request(suffix));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json() as Promise<AdminChangePage>;
}

test('owner reads exact typed actor/change metadata newest first, without another tenant or raw values', async () => {
  const changes: AdminChangeDetail[] = [
    { action: 'project.created' }, { action: 'project.settings_changed', fields: ['name', 'allowedOrigins'] },
    { action: 'schema.published', schemaVersion: 2 }, { action: 'schema.status_changed', schemaVersion: 2 },
    { action: 'grant.created', target, beforeRole: null, afterRole: 'reader' },
    { action: 'grant.role_changed', target, beforeRole: 'reader', afterRole: 'owner' },
    { action: 'grant.revoked', target, beforeRole: 'owner', afterRole: null },
  ];
  for (const [i, change] of changes.entries()) await record(change, now - i, i % 2 ? null : owner);
  await record({ action: 'schema.published', schemaVersion: 99 }, now, owner, 'other');
  const page = await read();
  assert.equal(page.projectId, 'sembom'); assert.equal(page.retentionDays, 90); assert.equal(page.coverage, 'recorded-changes-only');
  assert.equal(page.generatedAt, new Date(now).toISOString()); assert.deepEqual(page.page, { limit: 25, nextCursor: null });
  assert.deepEqual(page.data.map(r => r.change.action), changes.map(r => r.action));
  assert.deepEqual(page.data[0]!.actor, { kind: 'administrator', ...owner });
  assert.deepEqual(page.data[1]!.actor, { kind: 'local_operator' });
  assert.deepEqual(page.data[1]!.change, { action: 'project.settings_changed', fields: ['allowedOrigins', 'name'] });
  assert.deepEqual(page.data[6]!.change, changes[6]);
  for (const row of page.data) assert.deepEqual(Object.keys(row).sort(), ['actor', 'change', 'id', 'occurredAt']);
  assert.ok(!JSON.stringify(page).includes('actor_subject')); assert.ok(!JSON.stringify(page).includes('schemaVersion":99'));
  await f.db.prepare("UPDATE projects SET status='paused' WHERE id='sembom'").run();
  assert.equal((await read()).data.length, 7);
  await f.db.prepare("UPDATE projects SET status='active' WHERE id='sembom'").run();
});

test('keyset pages handle identical timestamps and deleted positions; later arrivals require restarting', async () => {
  for (let i = 0; i < 5; i++) await record({ action: 'project.created' }, now - 10);
  const ordered = (await f.db.prepare('SELECT id FROM admin_changes ORDER BY occurred_at DESC,id DESC').all<{ id: string }>()).results.map(r => r.id);
  const first = await read('?limit=2'); assert.deepEqual(first.data.map(r => r.id), ordered.slice(0, 2)); assert.ok(first.page.nextCursor);
  const decoded = JSON.parse(Buffer.from(first.page.nextCursor, 'base64url').toString());
  assert.deepEqual(decoded, [1, 'sembom', now - 10, ordered[1]]); assert.ok(!first.page.nextCursor.includes(owner.subject));
  await f.db.prepare('DELETE FROM admin_changes WHERE id=?').bind(ordered[1]!).run();
  await record({ action: 'schema.published', schemaVersion: 8 }, now);
  const second = await read(`?limit=2&cursor=${first.page.nextCursor}`);
  assert.deepEqual(second.data.map(r => r.id), ordered.slice(2, 4)); assert.ok(second.page.nextCursor);
  const third = await read(`?limit=2&cursor=${second.page.nextCursor}`);
  assert.deepEqual(third.data.map(r => r.id), ordered.slice(4)); assert.equal(third.page.nextCursor, null);
  assert.deepEqual((await read('?limit=2')).data[0]!.change, { action: 'schema.published', schemaVersion: 8 });
});

test('rolling retention excludes physically present expired and future records while keeping the exact boundary', async () => {
  const cutoff = now - 90 * DAY;
  for (const at of [cutoff - 1, cutoff, now, now + 1]) await record({ action: 'project.created' }, at);
  assert.equal(await f.db.prepare('SELECT count(*) FROM admin_changes').first('count(*)'), 4);
  assert.deepEqual((await read()).data.map(r => r.occurredAt), [now, cutoff].map(at => new Date(at).toISOString()));
  await f.db.prepare('DELETE FROM admin_changes').run();
  const empty = await read(); assert.deepEqual(empty.data, []); assert.equal(empty.page.nextCursor, null);
  assert.equal(empty.coverage, 'recorded-changes-only');
});

test('default and maximum page sizes stay bounded with a next cursor only when more records exist', async () => {
  await f.db.batch(Array.from({ length: 101 }, (_, i) => adminChangeStatement(f.db, 'sembom', null, { action: 'project.created' }, now - i, 'always')));
  assert.equal((await read()).data.length, 25);
  const page = await read('?limit=100'); assert.equal(page.data.length, 100); assert.ok(page.page.nextCursor);
  const last = await read(`?limit=100&cursor=${page.page.nextCursor}`); assert.equal(last.data.length, 1); assert.equal(last.page.nextCursor, null);
});

test('reader, missing/foreign grants and revoked owners cannot read any page or tenant history', async () => {
  await record({ action: 'grant.created', target, beforeRole: null, afterRole: 'reader' });
  await grant(target, 'reader'); await grant({ ...target, subject: 'foreign-owner' }, 'owner', 'other');
  for (const principal of [target, { ...owner, subject: 'none' }, { ...owner, issuer: 'https://foreign.example.invalid' },
    { ...owner, subject: 'foreign-owner' }]) assert.equal((await handler(principal)(request())).status, 403);
  assert.equal((await handler()(request('', 'GET', 'missing'))).status, 403);
  await record({ action: 'project.created' }, now - 1);
  const first = await read('?limit=1'); assert.ok(first.page.nextCursor);
  await f.db.prepare("UPDATE project_grants SET role='reader' WHERE subject=?").bind(owner.subject).run();
  assert.equal((await handler()(request(`?cursor=${first.page.nextCursor}`))).status, 403);
  await f.db.prepare("UPDATE project_grants SET role='owner' WHERE subject=?").bind(owner.subject).run();
  const proxy: SqlDatabase = { prepare: f.db.prepare.bind(f.db), async batch<T>(statements: SqlStatement[]) {
    await f.db.prepare('DELETE FROM project_grants WHERE subject=?').bind(owner.subject).run(); return f.db.batch<T>(statements);
  } };
  const denied = await handler(owner, new D1Queries(proxy))(request());
  assert.equal(denied.status, 403); assert.ok(!(await denied.text()).includes(target.subject));
});

test('strict bounded canonical cursors, parameters, authentication and GET-only declaration are enforced', async () => {
  await record({ action: 'project.created' }); await record({ action: 'project.created' }, now - 1);
  const first = await read('?limit=1'); assert.ok(first.page.nextCursor); await grant(owner, 'owner', 'other');
  const cursors = ['abc', '___', 'x'.repeat(513), `${first.page.nextCursor}=`,
    Buffer.from(JSON.stringify([2, 'sembom', now, first.data[0]!.id])).toString('base64url'),
    Buffer.from(JSON.stringify([1, 'sembom', -1, first.data[0]!.id])).toString('base64url'),
    Buffer.from(JSON.stringify([1, 'sembom', now, 'invalid-id'])).toString('base64url')];
  for (const cursor of cursors) assert.equal((await handler()(request(`?cursor=${encodeURIComponent(cursor)}`))).status, 400);
  assert.equal((await handler()(request(`?cursor=${first.page.nextCursor}`, 'GET', 'other'))).status, 400);
  for (const suffix of ['?limit=0', '?limit=101', '?limit=01', '?limit=1.5', '?limit=', '?limit=1&limit=2', '?cursor=&cursor=', '?actor=asserted'])
    assert.equal((await handler()(request(suffix))).status, 400);
  const unsupported = await handler()(request('', 'POST')); assert.equal(unsupported.status, 405); assert.equal(unsupported.headers.get('Allow'), 'GET');
  assert.equal((await handler()(request('', 'GET', 'INVALID'))).status, 400);
  assert.equal((await createCollector(f.store)(request())).status, 401);
  const missingAuth = await handler()(new Request('https://collector.example.invalid/v1/projects/sembom/changes'));
  assert.equal(missingAuth.status, 401); assert.equal(missingAuth.headers.get('WWW-Authenticate'), 'Bearer');
});

test('stored metadata and result corruption fail closed without raw errors or fabricated empty history', async () => {
  await record({ action: 'project.created' });
  const actual = await f.db.prepare('SELECT * FROM admin_changes').first<any>();
  for (const overrides of [{ id: 'bad' }, { actor_kind: 'local_operator' }, { fields_json: '["raw setting value"]' },
    { action: 'schema.published', schema_version: null }, { action: 'grant.created', before_role: 'reader', after_role: 'owner', target_issuer: owner.issuer, target_subject: target.subject },
    { schema_version: 1 }, { occurred_at: now + 1 }, { occurred_at: now - 90 * DAY - 1 }, { target_subject: 'unexpected' }]) {
    const bad: SqlDatabase = { prepare: f.db.prepare.bind(f.db), batch: async <T>() => [
      { success: true, meta: { changes: 0 }, results: [{ id: 'sembom' }] as T[] },
      { success: true, meta: { changes: 0 }, results: [{ ...actual, ...overrides }] as T[] },
    ] };
    const response = await handler(owner, new D1Queries(bad))(request());
    assert.equal(response.status, 503); assert.equal(response.headers.get('Retry-After'), '1');
    const text = await response.text(); assert.ok(!text.includes(owner.subject)); assert.ok(!text.includes('raw setting value'));
  }
  for (const batch of [async () => [], async () => { throw Error('private SQL error'); }]) {
    const response = await handler(owner, new D1Queries({ prepare: f.db.prepare.bind(f.db), batch }))(request());
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private SQL error'));
  }
});
