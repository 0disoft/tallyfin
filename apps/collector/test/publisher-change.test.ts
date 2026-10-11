import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AdminPrincipal, PublisherChangeResult } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '../../../packages/storage-d1/src/sql.ts';
import { setup, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let f: Awaited<ReturnType<typeof setup>>;
const owner: AdminPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
const target = { issuer: 'https://machine.example.invalid', subject: 'test-service' };
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['project_publishers', 'project_grants', 'admin_changes']) await f.db.prepare(`DELETE FROM ${table}`).run();
  await f.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', owner.issuer, owner.subject, 'owner', now).run();
});
function request(method = 'PUT', body: unknown = target, path = '/v1/projects/sembom/publishers') {
  return new Request(`https://collector.example.invalid${path}`, { method,
    headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function handler(principal = owner, store = new D1Queries(f.db), at = now) {
  return createCollector(f.store, { now: () => at, admin: { store, verifyBearer: async () => principal } });
}
async function mutate(method = 'PUT', body: unknown = target, at = now): Promise<PublisherChangeResult> {
  const response = await handler(owner, new D1Queries(f.db), at)(request(method, body));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json() as Promise<PublisherChangeResult>;
}

test('owner grant and guarded revoke are idempotent and atomically record only changed permissions', async () => {
  const granted = await mutate();
  assert.deepEqual(granted, { projectId: 'sembom', ...target, granted: true, createdAt: new Date(now).toISOString(), changed: true });
  await f.store.publisherAccess('sembom', target);
  assert.deepEqual(await mutate('PUT', target, now + 1), { ...granted, changed: false });
  const revoke = { ...target, expectedCreatedAt: granted.createdAt };
  assert.deepEqual(await mutate('DELETE', revoke, now + 2), { ...granted, granted: false, createdAt: null, changed: true });
  assert.deepEqual(await mutate('DELETE', revoke, now + 3), { ...granted, granted: false, createdAt: null, changed: false });
  await assert.rejects(f.store.publisherAccess('sembom', target), { code: 'forbidden' });
  const page = await new D1Queries(f.db).changes(owner, 'sembom', 25, '', now + 3);
  assert.deepEqual(page.data.map(row => row.change.action), ['publisher.revoked', 'publisher.granted']);
  assert.deepEqual(page.data[0]!.actor, { kind: 'administrator', ...owner });
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_grants').first('n'), 1);
});

test('stale creation timestamp and absent expectation cannot revoke an existing permission or change its history', async () => {
  const old = await mutate();
  await mutate('DELETE', { ...target, expectedCreatedAt: old.createdAt }, now + 1);
  const fresh = await mutate('PUT', target, now + 2);
  for (const expectedCreatedAt of [old.createdAt, null]) {
    const response = await handler()(request('DELETE', { ...target, expectedCreatedAt }));
    assert.equal(response.status, 409); const error = await response.json() as { error: { code: string } };
    assert.equal(error.error.code, 'publisher_conflict');
  }
  assert.equal(await f.db.prepare('SELECT created_at FROM project_publishers').first('created_at'), Date.parse(fresh.createdAt!));
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM admin_changes').first('n'), 3);
});

test('reader and publisher-only identities cannot write, and owner revocation before transaction blocks all changes', async () => {
  await f.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', owner.issuer, 'reader', 'reader', now).run();
  await f.db.prepare('INSERT INTO project_publishers (project_id,issuer,subject,created_at) VALUES (?,?,?,?)').bind('sembom', target.issuer, target.subject, now).run();
  for (const principal of [{ ...owner, subject: 'reader' }, target, { ...owner, subject: 'missing' }]) {
    for (const method of ['PUT', 'DELETE']) assert.equal((await handler(principal)(request(method, { broken: true }))).status, 403);
  }
  assert.equal((await handler()(request('PUT', target, '/v1/projects/missing/publishers'))).status, 403);
  // Settings preflight is permitted; the owner is removed immediately before the write snapshot.
  let calls = 0;
  const proxy: SqlDatabase = { prepare: f.db.prepare.bind(f.db), async batch<T>(statements: SqlStatement[]) {
    if (++calls === 2) await f.db.prepare('DELETE FROM project_grants WHERE subject=?').bind(owner.subject).run();
    return f.db.batch<T>(statements);
  } };
  const response = await handler(owner, new D1Queries(proxy))(request('PUT', { ...target, subject: 'new-service' }));
  assert.equal(response.status, 403);
  assert.equal(await f.db.prepare("SELECT count(*) AS n FROM project_publishers WHERE subject='new-service'").first('n'), 0);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM admin_changes').first('n'), 0);
});

test('audit storage failure rolls back permission, and closed bounded request/auth/method contracts are enforced', async () => {
  await f.db.prepare(`CREATE TRIGGER reject_new_publisher_history BEFORE INSERT ON admin_changes
    WHEN NEW.action='publisher.granted' BEGIN SELECT RAISE(ABORT,'test_failure'); END;`).run();
  const failure = await handler()(request()); assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes('test_failure'));
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_publishers').first('n'), 0);
  for (const body of [{ ...target, role: 'owner' }, { ...target, granted: true }, { ...target, issuer: 'http://unsafe.example.invalid' },
    { ...target, subject: '' }, { ...target, subject: 'a\nb' }])
    assert.equal((await handler()(request('PUT', body))).status, 400);
  for (const body of [target, { ...target, expectedCreatedAt: 'invalid' }, { ...target, expectedCreatedAt: 1 },
    { ...target, expectedCreatedAt: '2026-10-08T15:00:15Z' }, { ...target, expectedCreatedAt: null, role: 'owner' }])
    assert.equal((await handler()(request('DELETE', body))).status, 400);
  assert.equal((await handler()(request('PUT', target, '/v1/projects/sembom/publishers?extra=1'))).status, 400);
  const unsupported = await handler()(request('POST')); assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('Allow'), 'GET, PUT, DELETE');
  assert.equal((await createCollector(f.store)(request())).status, 401);
  const wrongType = request(); wrongType.headers.set('Content-Type', 'application/octet-stream');
  assert.equal((await handler()(wrongType)).status, 415);
  const tooLarge = request(); tooLarge.headers.set('Content-Length', '16385');
  assert.equal((await handler()(tooLarge)).status, 413);
});
