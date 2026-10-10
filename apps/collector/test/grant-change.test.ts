import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AdminPrincipal, GrantChange, GrantChangeResult } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '../../../packages/storage-d1/src/sql.ts';
import { setup, seed, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let f: Awaited<ReturnType<typeof setup>>;
const owner: AdminPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
const target = { issuer: owner.issuer, subject: 'test-reader' };
before(async () => { f = await setup(); await seed(f.db, 'other'); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  await f.db.prepare('DELETE FROM project_grants').run();
  await grant(owner, 'owner');
});
async function grant(identity: AdminPrincipal, role: string, project = 'sembom') {
  await f.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind(project, identity.issuer, identity.subject, role, now).run();
}
function handler(principal = owner, queries = new D1Queries(f.db)) {
  return createCollector(f.store, { now: () => now + 1000, admin: { store: queries, verifyBearer: async () => principal } });
}
function request(value: unknown, method = 'PUT', path = '/v1/projects/sembom/grants') {
  return new Request(`https://collector.example.invalid${path}`, { method,
    headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}
async function change(value: unknown, method = 'PUT', status = 200): Promise<any> {
  const response = await handler()(request(value, method));
  assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json();
}

test('owner adds, promotes and removes a grant with exact retries and preserved original creation time', async () => {
  const add = { ...target, role: 'reader', expectedRole: null };
  const created = await change(add) as GrantChangeResult;
  assert.deepEqual(created, { projectId: 'sembom', ...target, role: 'reader', createdAt: new Date(now + 1000).toISOString(), canManage: true, changed: true });
  assert.deepEqual(await change(add), { ...created, changed: false });
  const promoted = await change({ ...target, role: 'owner', expectedRole: 'reader' });
  assert.equal(promoted.role, 'owner'); assert.equal(promoted.changed, true); assert.equal(promoted.createdAt, created.createdAt);
  assert.deepEqual(await change({ ...target, role: 'owner', expectedRole: 'reader' }), { ...promoted, changed: false });
  const removed = await change({ ...target, expectedRole: 'owner' }, 'DELETE');
  assert.deepEqual(removed, { projectId: 'sembom', ...target, role: null, createdAt: null, canManage: true, changed: true });
  assert.deepEqual(await change({ ...target, expectedRole: 'owner' }, 'DELETE'), { ...removed, changed: false });
  assert.equal(await f.db.prepare("SELECT COUNT(*) FROM project_grants WHERE role='owner'").first('COUNT(*)'), 1);
});

test('missing or changed expectation conflicts and never rewrites a different current role', async () => {
  await grant(target, 'owner');
  for (const value of [{ ...target, role: 'reader', expectedRole: null }, { ...target, role: 'reader', expectedRole: 'reader' }])
    assert.equal((await change(value, 'PUT', 409)).error.code, 'grant_conflict');
  assert.equal((await change({ ...target, expectedRole: 'reader' }, 'DELETE', 409)).error.code, 'grant_conflict');
  assert.equal(await f.db.prepare('SELECT role FROM project_grants WHERE subject=?').bind(target.subject).first('role'), 'owner');
  assert.equal((await change({ ...target, subject: 'absent', role: 'owner', expectedRole: 'reader' }, 'PUT', 409)).error.code, 'grant_conflict');
});

test('the final owner cannot be demoted or removed; self removal with another owner succeeds and revokes later access', async () => {
  assert.equal((await change({ ...owner, role: 'reader', expectedRole: 'owner' }, 'PUT', 409)).error.code, 'last_owner');
  assert.equal((await change({ ...owner, expectedRole: 'owner' }, 'DELETE', 409)).error.code, 'last_owner');
  await grant(target, 'owner');
  const result = await change({ ...owner, expectedRole: 'owner' }, 'DELETE');
  assert.equal(result.canManage, false); assert.equal(result.changed, true);
  assert.equal((await handler()(request({ ...target, role: 'reader', expectedRole: 'owner' }))).status, 403);
  assert.equal(await f.db.prepare("SELECT COUNT(*) AS n FROM project_grants WHERE role='owner'").first('n'), 1);
});

test('reader, another project owner, wrong issuer, missing project and unauthenticated callers cannot mutate', async () => {
  await grant(target, 'reader'); await grant({ ...target, subject: 'other-owner' }, 'owner', 'other');
  const add = { ...target, subject: 'new-reader', role: 'reader', expectedRole: null };
  for (const identity of [target, { ...target, subject: 'other-owner' }, { ...owner, issuer: 'https://foreign.example.invalid' }])
    assert.equal((await handler(identity)(request(add))).status, 403);
  assert.equal((await handler()(request(add, 'PUT', '/v1/projects/absent/grants'))).status, 403);
  assert.equal((await createCollector(f.store)(request(add))).status, 401);
  // Privilege is checked before parsing an unsupported body/content type.
  assert.equal((await handler(target)(new Request('https://collector.example.invalid/v1/projects/sembom/grants', {
    method: 'PUT', headers: { Authorization: 'Bearer not-a-credential' }, body: 'not JSON' }))).status, 403);
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM project_grants WHERE subject=?').bind('new-reader').first('n'), 0);
});

test('owner revocation between preflight and mutation is checked again inside the atomic write batch', async () => {
  let calls = 0;
  const proxy: SqlDatabase = { prepare: f.db.prepare.bind(f.db), async batch<T>(statements: SqlStatement[]) {
    if (++calls === 2) await f.db.prepare('DELETE FROM project_grants WHERE subject=?').bind(owner.subject).run();
    return f.db.batch<T>(statements);
  } };
  const response = await handler(owner, new D1Queries(proxy))(request({ ...target, role: 'reader', expectedRole: null }));
  assert.equal(response.status, 403);
  assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM project_grants WHERE subject=?').bind(target.subject).first('n'), 0);
});

test('concurrent self-demotions preserve at least one owner and concurrent opposite updates report conflict', async () => {
  await grant(target, 'owner');
  const queries = new D1Queries(f.db);
  const outcomes = await Promise.allSettled([owner, target].map(principal => queries.changeGrant(principal, 'sembom', { ...principal, role: 'reader', expectedRole: 'owner' }, now)));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await f.db.prepare("SELECT COUNT(*) AS n FROM project_grants WHERE role='owner'").first('n'), 1);
  const remaining = await f.db.prepare("SELECT issuer,subject FROM project_grants WHERE role='owner'").first<AdminPrincipal>();
  assert.ok(remaining);
  const third = { issuer: owner.issuer, subject: 'third' }; await grant(third, 'reader');
  const results = await Promise.allSettled([
    queries.changeGrant(remaining, 'sembom', { ...third, role: 'owner', expectedRole: 'reader' }, now),
    queries.changeGrant(remaining, 'sembom', { ...third, role: null, expectedRole: 'reader' }, now),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'grant_conflict').length, 1);
});

test('closed and bounded requests reject malformed bodies, extra parameters and unsupported methods', async () => {
  const add = { ...target, role: 'reader', expectedRole: null };
  for (const input of [{ ...add, owner: owner.subject }, { ...add, role: 'admin' }, { ...add, issuer: 'http://example.invalid' }, { ...add, subject: '' }])
    await change(input, 'PUT', 400);
  await change(add, 'DELETE', 400);
  assert.equal((await handler()(request(add, 'PUT', '/v1/projects/sembom/grants?extra=1'))).status, 400);
  const unsupported = await handler()(request(add, 'POST'));
  assert.equal(unsupported.status, 405); assert.equal(unsupported.headers.get('Allow'), 'GET, PUT, DELETE');
  for (const [body, type, status] of [['{', 'application/json', 400], ['{}', 'application/x-www-form-urlencoded', 415], ['x'.repeat(16385), 'application/json', 413]] as const) {
    const response = await handler()(new Request('https://collector.example.invalid/v1/projects/sembom/grants', {
      method: 'PUT', headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': type }, body }));
    assert.equal(response.status, status);
  }
});

test('storage write failure exposes no database details and leaves the target unchanged', async () => {
  await f.db.prepare("CREATE TRIGGER reject_grant BEFORE INSERT ON project_grants BEGIN SELECT RAISE(ABORT,'private database detail'); END").run();
  try {
    const response = await handler()(request({ ...target, role: 'reader', expectedRole: null }));
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private database detail'));
    assert.equal(await f.db.prepare('SELECT COUNT(*) AS n FROM project_grants WHERE subject=?').bind(target.subject).first('n'), 0);
  } finally { await f.db.prepare('DROP TRIGGER reject_grant').run(); }
});
