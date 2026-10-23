import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { parseSaveSchemaDraft, SAVED_SCHEMA_DRAFT_POLICY } from '@tallyfin/core';
import { D1Queries } from '@tallyfin/storage-d1';
import { setup, seed, now } from '../../../packages/storage-d1/test/helpers.ts';
import { createCollector } from '../src/handler.ts';

let fixture: Awaited<ReturnType<typeof setup>>;
const principal = { issuer: 'https://identity.example.invalid', subject: 'draft-owner' };
before(async () => { fixture = await setup(); });
after(async () => { await fixture?.mf.dispose(); });
beforeEach(async () => {
  for (const table of ['project_schema_drafts', 'project_grants', 'project_schemas', 'projects']) await fixture.db.prepare(`DELETE FROM ${table}`).run();
  await seed(fixture.db);
  await fixture.db.prepare('INSERT INTO project_grants(project_id,issuer,subject,role,created_at) VALUES(?,?,?,?,?)')
    .bind('sembom', principal.issuer, principal.subject, 'owner', now).run();
});
const value = (expectedRevision: string | null = null, draftText = '{미완성 한글\n') => ({ expectedRevision, targetVersion: '', draftText });
const request = (method = 'GET', body?: unknown, projectId = 'sembom') => new Request(`https://collector.example.invalid/v1/projects/${projectId}/schemas/draft`, {
  method, headers: { Authorization: 'Bearer not-a-credential', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const api = (store = new D1Queries(fixture.db)) => createCollector(fixture.store, { now: () => now, admin: { store, verifyBearer: async () => principal } });

test('owner explicitly saves unfinished text and reloads it through another instance without publishing or changing ingestion', async () => {
  const first = api(), second = api(), settings = await fixture.db.prepare('SELECT * FROM projects').first();
  assert.deepEqual(await (await first(request())).json(), { projectId: 'sembom', draft: null });
  const saved = await first(request('PUT', value())); assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('Cache-Control'), 'no-store'); assert.equal(saved.headers.get('Access-Control-Allow-Origin'), null);
  const body = await saved.json() as any;
  assert.match(body.draft.revision, /^[0-9a-f]{32}$/); assert.equal(body.draft.draftText, value().draftText); assert.equal(body.draft.targetVersion, '');
  assert.deepEqual(await (await second(request())).json(), body);
  const updated = await second(request('PUT', value(body.draft.revision, ''))); assert.equal(updated.status, 200);
  const next = await updated.json() as any; assert.notEqual(next.draft.revision, body.draft.revision); assert.equal(next.draft.draftText, '');
  assert.deepEqual(await fixture.db.prepare('SELECT * FROM projects').first(), settings);
  assert.equal(await fixture.db.prepare('SELECT count(*) AS n FROM project_schemas').first('n'), 1);
  assert.equal(await fixture.db.prepare('SELECT count(*) AS n FROM admin_changes').first('n'), 0);
});

test('concurrent create and edit requests each have exactly one CAS winner across collector instances', async () => {
  for (const revision of [null, 'read-current']) {
    const current = (await (await api()(request())).json() as any).draft?.revision ?? null;
    assert.equal(revision === null, current === null);
    const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => api()(request('PUT', value(current, `draft-${i}`)))));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409, 409, 409]);
    const winner = await responses.find(r => r.status === 200)!.json() as any;
    assert.deepEqual(await (await api()(request())).json(), winner);
    for (const response of responses.filter(r => r.status === 409)) assert.equal((await response.json() as any).error.code, 'schema_draft_conflict');
  }
  assert.equal(await fixture.db.prepare('SELECT count(*) AS n FROM project_schema_drafts').first('n'), 1);
});

test('stale revisions and unknown non-null revisions never create or overwrite data; lost success can be confirmed by readback', async () => {
  assert.equal((await api()(request('PUT', value('a'.repeat(32))))).status, 409);
  const saved = await (await api()(request('PUT', value()))).json();
  assert.equal((await api()(request('PUT', value(null, 'retry')))).status, 409);
  assert.deepEqual(await (await api()(request())).json(), saved);
});

test('authentication and owner access precede body decoding, and a grant race is rechecked inside the write', async () => {
  const unauthenticated = createCollector(fixture.store);
  assert.equal((await unauthenticated(request('PUT', {}))).status, 401);
  await fixture.db.prepare("UPDATE project_grants SET role='reader'").run();
  assert.equal((await api()(request())).status, 403); assert.equal((await api()(request('PUT', {}))).status, 403);
  assert.equal((await api()(request('GET', undefined, 'other'))).status, 403);
  await fixture.db.prepare("UPDATE project_grants SET role='owner'").run();
  const store = new D1Queries(fixture.db), original = store.settings.bind(store);
  store.settings = async (...args) => { const result = await original(...args); await fixture.db.prepare("UPDATE project_grants SET role='reader'").run(); return result; };
  assert.equal((await api(store)(request('PUT', value()))).status, 403);
  assert.equal(await fixture.db.prepare('SELECT count(*) AS n FROM project_schema_drafts').first('n'), 0);
});

test('envelope limits match downloadable file bytes, reject extra approval fields and never validate draft JSON', async () => {
  const base = value(), envelope = (text: string) => JSON.stringify({ format: 'tallyfin.schema-draft/v1', projectId: 'sembom', targetVersion: '', draftText: text }, null, 2) + '\n';
  const maxText = 'x'.repeat(SAVED_SCHEMA_DRAFT_POLICY.fileBytes - new TextEncoder().encode(envelope('')).length);
  assert.equal(parseSaveSchemaDraft(value(null, maxText), 'sembom').draftText, maxText);
  assert.throws(() => parseSaveSchemaDraft(value(null, maxText + 'x'), 'sembom'));
  assert.equal((await api()(request('PUT', value(null, maxText)))).status, 200);
  assert.equal((await api()(request('PUT', value(null, maxText + 'x')))).status, 413);
  for (const invalid of [{ ...base, privacyReviewed: true }, { ...base, expectedRevision: '' }, { ...base, targetVersion: 'x'.repeat(33) }, { ...base, draftText: {} }])
    assert.equal((await api()(request('PUT', invalid))).status, 400);
  assert.equal((await api()(request('DELETE', base))).status, 405);
});

test('new storage constraints reject malformed envelopes and project deletion removes its draft', async () => {
  for (const payload of ['{}', '{"targetVersion":""}', '{"targetVersion":"","draftText":"","approval":true}'])
    await assert.rejects(fixture.db.prepare('INSERT INTO project_schema_drafts VALUES(?,?,?,?)').bind('sembom', 'a'.repeat(32), payload, now).run());
  assert.equal((await api()(request('PUT', value()))).status, 200);
  await fixture.db.prepare("DELETE FROM project_grants WHERE project_id='sembom'").run();
  await fixture.db.prepare("DELETE FROM project_schemas WHERE project_id='sembom'").run();
  await fixture.db.prepare("DELETE FROM projects WHERE id='sembom'").run();
  assert.equal(await fixture.db.prepare('SELECT count(*) AS n FROM project_schema_drafts').first('n'), 0);
});
