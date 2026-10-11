import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AdminPrincipal, ProjectPublisherPage } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '../../../packages/storage-d1/src/sql.ts';
import { setup, seed, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal: AdminPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
before(async () => { fixture = await setup(); await seed(fixture.db, 'other'); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  await fixture.db.prepare('DELETE FROM project_publishers').run();
  await fixture.db.prepare('DELETE FROM project_grants').run();
  await fixture.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', principal.issuer, principal.subject, 'owner', now).run();
});
async function publisher(subject: string, project = 'sembom', issuer = principal.issuer) {
  await fixture.db.prepare('INSERT INTO project_publishers VALUES (?,?,?,?)').bind(project, issuer, subject, now).run();
}
function request(path = '/v1/projects/sembom/publishers', method = 'GET') {
  return new Request(`https://collector.example.invalid${path}`, { method, headers: { Authorization: 'Bearer not-a-credential' } });
}
function handler(identity: AdminPrincipal = principal, store = new D1Queries(fixture.db)) {
  return createCollector(fixture.store, { admin: { store, verifyBearer: async () => identity } });
}
async function read(path = '/v1/projects/sembom/publishers'): Promise<ProjectPublisherPage> {
  const response = await handler()(request(path));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json() as Promise<ProjectPublisherPage>;
}

test('owner reads live bounded publishing identities, independently of reader/owner grants and other projects', async () => {
  assert.deepEqual((await read()).data, []);
  await publisher('alpha'); await publisher('zeta'); await publisher('alpha', 'sembom', 'https://second.example.invalid');
  await publisher('private-other', 'other');
  const first = await read('/v1/projects/sembom/publishers?limit=2');
  assert.deepEqual(first.data, ['alpha', 'zeta'].map(subject => ({ ...principal, subject, createdAt: new Date(now).toISOString() })));
  assert.ok(first.page.nextCursor);
  const second = await read(`/v1/projects/sembom/publishers?limit=2&cursor=${first.page.nextCursor}`);
  assert.deepEqual(second.data.map(p => p.issuer), ['https://second.example.invalid']); assert.equal(second.page.nextCursor, null);
  assert.equal((await read()).page.limit, 25);
  await fixture.db.prepare("UPDATE projects SET status='paused' WHERE id='sembom'").run();
  await fixture.db.prepare("DELETE FROM project_schemas WHERE project_id='sembom'").run();
  assert.equal((await read()).data.length, 3);
});

test('publisher-only, reader, foreign-project owner, missing project and revoked owner cannot see identities', async () => {
  await publisher('machine-only');
  await fixture.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', principal.issuer, 'reader', 'reader', now).run();
  await fixture.db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('other', principal.issuer, 'foreign-owner', 'owner', now).run();
  for (const subject of ['machine-only', 'reader', 'foreign-owner', 'missing']) {
    const response = await handler({ ...principal, subject })(request());
    assert.equal(response.status, 403); assert.ok(!(await response.text()).includes('machine-only'));
  }
  assert.equal((await handler()(request('/v1/projects/missing/publishers'))).status, 403);
  await publisher('zeta');
  const page = await read('/v1/projects/sembom/publishers?limit=1');
  const proxy: SqlDatabase = { prepare: fixture.db.prepare.bind(fixture.db), async batch<T>(statements: SqlStatement[]) {
    await fixture.db.prepare('DELETE FROM project_grants WHERE subject=?').bind(principal.subject).run();
    return fixture.db.batch<T>(statements);
  } };
  const response = await handler(principal, new D1Queries(proxy))(request(`/v1/projects/sembom/publishers?cursor=${page.page.nextCursor}`));
  assert.equal(response.status, 403); assert.ok(!(await response.text()).includes('zeta'));
});

test('publisher cursor is scoped to project and list kind and preserves Unicode and maximum identities', async () => {
  const issuer = `https://long.example.invalid/${'a'.repeat(483)}`, subject = `A${'한😀"'.repeat(127)}끝`;
  await publisher(subject, 'sembom', issuer); await publisher('Z-next', 'sembom', issuer);
  const first = await read('/v1/projects/sembom/publishers?limit=1');
  assert.equal(first.data[0]!.subject, subject); assert.ok(first.page.nextCursor && first.page.nextCursor.length > 512);
  const cursor = first.page.nextCursor;
  await fixture.db.prepare('DELETE FROM project_publishers WHERE subject=?').bind(subject).run();
  assert.equal((await read(`/v1/projects/sembom/publishers?cursor=${cursor}`)).data[0]!.subject, 'Z-next');
  for (const path of [`/v1/projects/other/publishers?cursor=${cursor}`, `/v1/projects/sembom/grants?cursor=${cursor}`])
    assert.equal((await handler()(request(path))).status, 400);
  const grantCursor = Buffer.from(JSON.stringify([1, 'sembom', principal.issuer, principal.subject])).toString('base64url');
  assert.equal((await handler()(request(`/v1/projects/sembom/publishers?cursor=${grantCursor}`))).status, 400);
});

test('invalid queries and unsupported methods fail; authentication and storage failures disclose no private material', async () => {
  for (const suffix of ['?limit=0', '?limit=101', '?limit=01', '?limit=1&limit=2', '?cursor=&cursor=', '?subject=x',
    '?cursor=abc', '?cursor=___', `?cursor=${'x'.repeat(12289)}`])
    assert.equal((await handler()(request(`/v1/projects/sembom/publishers${suffix}`))).status, 400);
  assert.equal((await handler()(request('/v1/projects/INVALID/publishers'))).status, 400);
  const method = await handler()(request(undefined, 'POST'));
  assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'GET');
  assert.equal((await createCollector(fixture.store)(request())).status, 401);
  for (const batch of [async () => [], async () => { throw Error('private database error'); }]) {
    const response = await handler(principal, new D1Queries({ prepare: fixture.db.prepare.bind(fixture.db), batch }))(request());
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private database error'));
  }
  await publisher('bad'); await fixture.db.prepare("UPDATE project_publishers SET issuer='http://invalid.example.invalid' WHERE subject='bad'").run();
  assert.equal((await handler()(request())).status, 503);
});
