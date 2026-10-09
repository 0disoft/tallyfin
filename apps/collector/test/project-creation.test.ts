import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { D1Queries } from '@tallyfin/storage-d1';
import { setup, now, registry } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let f: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'test-creator' };
const input = { id: 'api-created', name: 'API created', timeZone: 'Asia/Seoul', allowedOrigins: ['https://new.example.invalid'],
  limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 } };
before(async () => { f = await setup(); });
after(async () => { await f?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['project_grants', 'project_schemas', 'project_creations']) await f.db.prepare(`DELETE FROM ${table}`).run();
  await f.db.prepare("DELETE FROM projects WHERE id != 'sembom'").run();
  await f.db.prepare('DELETE FROM project_creators').run();
  await f.db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(principal.issuer, principal.subject, now).run();
});
const handler = (local = false) => createCollector(f.store, { now: () => now, admin: { store: new D1Queries(f.db, { allowLocalHttp: local }), verifyBearer: async () => principal } });
const request = (value: unknown = input, path = '/v1/projects', method = 'POST', type = 'application/json') => new Request(`https://collector.example.invalid${path}`, {
  method, headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': type }, ...(method === 'GET' ? {} : { body: JSON.stringify(value) }),
});
test('authenticated creator can read the fresh project, publish its first schema and retry creation', async () => {
  const response = await handler()(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null); assert.equal(response.headers.get('Set-Cookie'), null);
  const created = await response.json(); assert.deepEqual(await (await handler()(request())).json(), created);
  const list = await (await handler()(request(null, '/v1/projects', 'GET'))).json() as any;
  assert.deepEqual(list.data.map((r: any) => r.id), [input.id]);
  const settings = await (await handler()(request(null, `/v1/projects/${input.id}`, 'GET'))).json() as any;
  assert.equal(settings.canEdit, true); assert.equal(settings.project.status, 'active');
  const publish = await handler()(request({ expectedLatestVersion: null, privacyReviewed: true, events: registry.events, workflows: registry.workflows },
    `/v1/projects/${input.id}/schemas/1`, 'PUT'));
  assert.equal(publish.status, 200);
  assert.equal((await handler()(request(null, `/v1/projects/${input.id}/schemas/1`, 'GET'))).status, 200);
});
test('no verifier/no bearer returns 401 and project owners without creator permission return 403 before body reading', async () => {
  const noAuth = createCollector(f.store);
  assert.equal((await noAuth(request())).status, 401);
  const noBearer = request(); noBearer.headers.delete('Authorization');
  assert.equal((await handler()(noBearer)).status, 401);
  await f.db.prepare('DELETE FROM project_creators').run();
  await f.db.prepare("INSERT INTO project_grants VALUES ('sembom',?,?,'owner',?)").bind(principal.issuer, principal.subject, now).run();
  const denied = request(); assert.equal((await handler()(denied)).status, 403); assert.equal(denied.bodyUsed, false);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM project_creations').first('n'), 0);
});
test('closed body rejects ownership, status, definitions, missing fields and invalid time zones or origins', async () => {
  for (const value of [null, {}, { ...input, owner: principal }, { ...input, status: 'active' }, { ...input, events: [] },
    { ...input, name: ' ' }, { ...input, timeZone: 'invalid' }, { ...input, allowedOrigins: ['https://*.invalid'] },
    { ...input, allowedOrigins: ['http://remote.invalid'] }, { ...input, allowedOrigins: ['http://localhost:5173'] }])
    assert.equal((await handler()(request(value))).status, 400);
  const local = { ...input, allowedOrigins: ['http://localhost:5173'] };
  assert.equal((await handler(true)(request(local))).status, 200);
});
test('HTTP body bounds, encoding, query parameters and methods are enforced without leaking raw errors', async () => {
  for (const [body, type, status] of [['{', 'application/json', 400], ['x'.repeat(16385), 'application/json', 413], ['{}', 'application/xml', 415]] as const) {
    const r = new Request('https://collector.example.invalid/v1/projects', { method: 'POST', body,
      headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': type } });
    assert.equal((await handler()(r)).status, status);
  }
  const encoded = request(); encoded.headers.set('Content-Encoding', 'gzip'); assert.equal((await handler()(encoded)).status, 415);
  assert.equal((await handler()(request(input, '/v1/projects?limit=25'))).status, 400);
  const wrong = await handler()(request(input, '/v1/projects', 'DELETE'));
  assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('Allow'), 'GET, POST');
  const plain = await handler()(request(input, '/v1/projects', 'POST', 'text/plain'));
  assert.equal(plain.status, 200);
});
test('ID collisions and exhausted limits return distinct 409 errors and storage errors stay fixed', async () => {
  await handler()(request());
  const collision = await handler()(request({ ...input, name: 'other' }));
  assert.equal(collision.status, 409); assert.equal((await collision.json() as any).error.code, 'project_conflict');
  await f.db.prepare('UPDATE project_creators SET max_projects=1').run();
  const exhausted = await handler()(request({ ...input, id: 'second' }));
  assert.equal(exhausted.status, 409); assert.equal((await exhausted.json() as any).error.code, 'project_limit_reached');
  assert.equal(exhausted.headers.get('Retry-After'), null);
  const unavailable = createCollector(f.store, { admin: { store: new D1Queries({ prepare: () => { throw Error('private database message'); }, batch: async () => [] }), verifyBearer: async () => principal } });
  const error = await unavailable(request()); assert.equal(error.status, 503); assert.ok(!(await error.text()).includes('private database message'));
});
