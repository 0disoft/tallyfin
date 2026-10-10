import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AdminPrincipal, ProjectGrantPage } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import type { SqlDatabase, SqlStatement } from '../../../packages/storage-d1/src/sql.ts';
import { setup, seed, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal: AdminPrincipal = { issuer: 'https://identity.example.invalid', subject: 'test-owner' };
before(async () => { fixture = await setup(); await seed(fixture.db, 'other'); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  await fixture.db.prepare('DELETE FROM project_grants').run();
  await grant(principal.issuer, principal.subject, 'owner');
});
async function grant(issuer: string, subject: string, role = 'reader', project = 'sembom') {
  await fixture.db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
    .bind(project, issuer, subject, role, now).run();
}
function request(path = '/v1/projects/sembom/grants', method = 'GET') {
  return new Request(`https://collector.example.invalid${path}`, { method, headers: { Authorization: 'Bearer not-a-credential' } });
}
function handler(identity: AdminPrincipal = principal, store = new D1Queries(fixture.db)) {
  return createCollector(fixture.store, { admin: { store, verifyBearer: async () => identity } });
}
async function read(path = '/v1/projects/sembom/grants', identity = principal): Promise<ProjectGrantPage> {
  const response = await handler(identity)(request(path));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Set-Cookie'), null);
  return response.json() as Promise<ProjectGrantPage>;
}

test('owner reads bounded grants in issuer/subject order, without other project identities or private fields', async () => {
  await grant(principal.issuer, 'alpha'); await grant(principal.issuer, 'zeta');
  await grant('https://second.example.invalid', 'alpha', 'owner');
  await grant(principal.issuer, principal.subject, 'owner', 'other');
  await grant(principal.issuer, 'other-project-only', 'reader', 'other');
  const first = await read('/v1/projects/sembom/grants?limit=2');
  assert.equal(first.projectId, 'sembom'); assert.equal(first.page.limit, 2);
  assert.deepEqual(first.data.map(g => g.subject), ['alpha', 'test-owner']);
  assert.deepEqual(first.data[0], { issuer: principal.issuer, subject: 'alpha', role: 'reader', createdAt: new Date(now).toISOString() });
  assert.ok(first.page.nextCursor);
  const second = await read(`/v1/projects/sembom/grants?limit=2&cursor=${first.page.nextCursor}`);
  assert.deepEqual(second.data.map(g => [g.issuer, g.subject]), [[principal.issuer, 'zeta'], ['https://second.example.invalid', 'alpha']]);
  assert.equal(second.page.nextCursor, null);
  assert.equal((await read()).page.limit, 25);
  // Paused projects still allow control-plane reads.
  await fixture.db.prepare("UPDATE projects SET status='paused' WHERE id='sembom'").run();
  assert.equal((await read()).data.length, 4);
  await fixture.db.prepare("UPDATE projects SET status='active' WHERE id='sembom'").run();
});

test('reader, missing grant/project, foreign issuer and foreign-project owner cannot read the list', async () => {
  await grant(principal.issuer, 'reader');
  for (const identity of [{ ...principal, subject: 'reader' }, { ...principal, issuer: 'https://foreign.example.invalid' },
    { ...principal, subject: 'no-grant' }]) assert.equal((await handler(identity)(request())).status, 403);
  await grant(principal.issuer, 'foreign-owner', 'owner', 'other');
  assert.equal((await handler({ ...principal, subject: 'foreign-owner' })(request())).status, 403);
  assert.equal((await handler()(request('/v1/projects/missing/grants'))).status, 403);
});

test('page position survives deletion but is never authority; demotion and revocation are checked on each snapshot', async () => {
  await grant(principal.issuer, 'alpha'); await grant(principal.issuer, 'zeta');
  const first = await read('/v1/projects/sembom/grants?limit=1');
  const path = `/v1/projects/sembom/grants?limit=1&cursor=${first.page.nextCursor}`;
  await fixture.db.prepare("DELETE FROM project_grants WHERE subject='alpha'").run();
  assert.equal((await read(path)).data[0]!.subject, principal.subject);
  await fixture.db.prepare("UPDATE project_grants SET role='reader' WHERE subject=?").bind(principal.subject).run();
  assert.equal((await handler()(request(path))).status, 403);
  await fixture.db.prepare("UPDATE project_grants SET role='owner' WHERE subject=?").bind(principal.subject).run();
  const proxy: SqlDatabase = { prepare: fixture.db.prepare.bind(fixture.db), async batch<T>(statements: SqlStatement[]) {
    await fixture.db.prepare('DELETE FROM project_grants WHERE subject=?').bind(principal.subject).run();
    return fixture.db.batch<T>(statements);
  } };
  const response = await handler(principal, new D1Queries(proxy))(request(path));
  assert.equal(response.status, 403); assert.ok(!(await response.text()).includes('zeta'));
});

test('cursor preserves Unicode, quotes, and maximum provisioned identity lengths', async () => {
  const long: AdminPrincipal = { issuer: `https://long.example.invalid/${'a'.repeat(483)}`, subject: `A${'한😀"'.repeat(127)}끝` };
  assert.ok(long.issuer.length <= 512 && long.subject.length <= 512);
  await grant(long.issuer, long.subject, 'owner'); await grant(long.issuer, 'Z-next');
  const first = await read('/v1/projects/sembom/grants?limit=2', long);
  assert.equal(first.data[1]!.subject, long.subject);
  assert.ok(first.page.nextCursor && first.page.nextCursor.length > 512);
  const second = await read(`/v1/projects/sembom/grants?limit=2&cursor=${first.page.nextCursor}`, long);
  assert.equal(second.data[0]!.subject, 'Z-next'); assert.equal(second.page.nextCursor, null);
});

test('malformed/cross-project cursors, unbounded/duplicate/extra parameters and unsupported methods are rejected', async () => {
  await grant(principal.issuer, 'alpha');
  const first = await read('/v1/projects/sembom/grants?limit=1');
  await grant(principal.issuer, principal.subject, 'owner', 'other');
  const badCursors = ['abc', '___', 'x'.repeat(12289), `${first.page.nextCursor}=`,
    Buffer.from(JSON.stringify([1, 'sembom', principal.issuer, ''])).toString('base64url'),
    Buffer.from(JSON.stringify([2, 'sembom', principal.issuer, 'alpha'])).toString('base64url')];
  for (const cursor of badCursors) assert.equal((await handler()(request(`/v1/projects/sembom/grants?cursor=${encodeURIComponent(cursor)}`))).status, 400);
  assert.equal((await handler()(request(`/v1/projects/other/grants?cursor=${first.page.nextCursor}`))).status, 400);
  for (const suffix of ['?limit=0', '?limit=101', '?limit=1.5', '?limit=01', '?limit=', '?limit=1&limit=2',
    '?cursor=&cursor=', '?subject=asserted', '?limit=1&extra=1'])
    assert.equal((await handler()(request(`/v1/projects/sembom/grants${suffix}`))).status, 400);
  assert.equal((await handler()(request('/v1/projects/INVALID/grants'))).status, 400);
  const denied = await handler()(request(undefined, 'POST'));
  assert.equal(denied.status, 405); assert.equal(denied.headers.get('Allow'), 'GET, PUT, DELETE');
});

test('missing verifier/auth and storage failures return generic errors without identity or exception disclosure', async () => {
  assert.equal((await createCollector(fixture.store)(request())).status, 401);
  const unauthenticated = await handler()(new Request('https://collector.example.invalid/v1/projects/sembom/grants'));
  assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.headers.get('WWW-Authenticate'), 'Bearer');
  for (const batch of [async () => [], async () => { throw Error('private database error'); }]) {
    const store = new D1Queries({ prepare: fixture.db.prepare.bind(fixture.db), batch });
    const response = await handler(principal, store)(request());
    assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(!(await response.text()).includes('private database error'));
  }
  await grant(principal.issuer, 'bad-row');
  await fixture.db.prepare("UPDATE project_grants SET subject='' WHERE subject='bad-row'").run();
  assert.equal((await handler()(request())).status, 503);
});
