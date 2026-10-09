import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { D1Queries } from '@tallyfin/storage-d1';
import { createCollector } from '../src/handler.ts';
import { migrationStatements, setup, registry, now, seed } from '../../../packages/storage-d1/test/helpers.ts';
import type { CollectionStore, RejectionReason } from '@tallyfin/core';

const principal = { issuer: 'https://identity.example.invalid', subject: 'rejections-http-test' };
const path = '/v1/projects/sembom/collection/rejections?from=2026-10-08&to=2026-10-08';
const request = (path: string, method = 'GET', bearer = true) => new Request(`https://collector.example.invalid${path}`, {
  method, headers: bearer ? { Authorization: 'Bearer not-a-credential' } : {},
});
const post = (body: string, origin = registry.allowedOrigins[0]!, id = 'sembom') => new Request(`https://collector.example.invalid/v1/projects/${id}/batches`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
});
async function grant(db: Awaited<ReturnType<typeof setup>>['db'], role = 'reader') {
  await db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', principal.issuer, principal.subject, role, now).run();
}
test('real rejected requests distinguish minute/daily limits, exclude administrative failures and preserve public response privacy', async () => {
  const f = await setup();
  try {
    await grant(f.db);
    const handler = createCollector(f.store, { now: () => now, admin: { store: new D1Queries(f.db), verifyBearer: async () => principal } });
    const denied = await handler(post('{"private":"never-store-this"}', 'https://untrusted.example.invalid'));
    assert.equal(denied.status, 403); assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await denied.json() as { error: { code: string } }).error.code, 'origin_denied');
    assert.equal((await handler(post('{bad-json'))).status, 400);
    assert.equal((await handler(post(JSON.stringify({ schemaVersion: 99, source: 'browser', events: [{
      eventId: crypto.randomUUID(), name: 'tool_view', occurredAt: new Date(now).toISOString(), properties: { tool: 'loan' },
    }] })))).status, 422);
    await f.db.prepare('UPDATE projects SET new_receipts_per_utc_day=1').run();
    const input = { schemaVersion: 1, source: 'browser', events: ['tool_view', 'tool_view'].map(name => ({ eventId: crypto.randomUUID(), name,
      occurredAt: new Date(now).toISOString(), properties: { tool: 'loan' } })) };
    const daily = await handler(post(JSON.stringify(input))); assert.equal(daily.status, 429);
    assert.equal(daily.headers.get('Retry-After'), '32385');
    await f.db.prepare('UPDATE projects SET requests_per_minute=1').run();
    const minute = await handler(post('{}')); assert.equal(minute.status, 429); assert.equal(minute.headers.get('Retry-After'), '45');
    assert.equal((await handler(request('/v1/projects/sembom/unknown'))).status, 404);
    assert.equal((await handler(post('{}', registry.allowedOrigins[0], 'missing'))).status, 404);
    const result = await handler(request(path)); assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert.equal(result.headers.get('Set-Cookie'), null);
    const body = await result.json() as { summary: { rejectedRequests: number; reasons: { reason: string; count: number }[] } };
    assert.equal(body.summary.rejectedRequests, 5);
    assert.equal(body.summary.reasons.find(row => row.reason === 'daily_limit')?.count, 1);
    assert.equal(body.summary.reasons.find(row => row.reason === 'minute_limit')?.count, 1);
    assert.ok(!JSON.stringify(body).includes('never-store-this')); assert.ok(!JSON.stringify(body).includes('untrusted.example.invalid'));
    assert.ok(!JSON.stringify(body).includes('not-a-credential'));
    assert.equal(await f.db.prepare('SELECT count(*) FROM event_receipts').first('count(*)'), 0);
    assert.equal(await f.db.prepare('SELECT latest_received_at FROM projects').first('latest_received_at'), null);
  } finally { await f.mf.dispose(); }
});
test('reader and owner can query seven UTC dates, with strict parameters and rechecked project grants', async () => {
  const f = await setup();
  try {
    await grant(f.db); await seed(f.db, 'other');
    const handler = createCollector(f.store, { now: () => now, admin: { store: new D1Queries(f.db), verifyBearer: async () => principal } });
    assert.equal((await handler(request(path, 'GET', false))).status, 401);
    assert.equal((await createCollector(f.store, { now: () => now })(request(path))).status, 401);
    assert.equal((await handler(request(path.replace('sembom', 'other')))).status, 403);
    assert.equal((await handler(request(path.replace('sembom', 'missing')))).status, 404);
    for (const suffix of ['?from=2026-10-01&to=2026-10-08', '?from=2026-10-08&to=2026-10-09', '?from=2026-02-30&to=2026-10-08',
      '?from=2026-10-08&to=2026-10-08&schemaVersion=1', '?from=2026-10-08&from=2026-10-08&to=2026-10-08', '?to=2026-10-08'])
      assert.equal((await handler(request(path.split('?')[0] + suffix))).status, 400);
    const method = await handler(request(path, 'POST')); assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'GET');
    assert.equal((await handler(request(path))).status, 200);
    await f.db.prepare("UPDATE project_grants SET role='owner'").run(); assert.equal((await handler(request(path))).status, 200);
    await f.db.prepare("UPDATE projects SET status='paused' WHERE id='sembom'").run();
    await f.db.prepare("DELETE FROM project_schemas WHERE project_id='sembom'").run();
    assert.equal((await handler(request(path))).status, 200);
    const proxy = { prepare: f.db.prepare.bind(f.db), batch: async <T>(queries: Parameters<typeof f.store.db.batch>[0]) => {
      await f.db.prepare('DELETE FROM project_grants').run(); return f.db.batch<T>(queries as Parameters<typeof f.db.batch>[0]);
    } };
    await assert.rejects(new D1Queries(proxy).rejections(principal, 'sembom', '2026-10-08', '2026-10-08', now),
      (error: unknown) => (error as { code: string }).code === 'forbidden');
  } finally { await f.mf.dispose(); }
});
test('background recording never delays or changes the rejection response, and sink failure is swallowed without retry', async () => {
  let release: (() => void) | undefined, calls = 0; const tasks: Promise<void>[] = [];
  const store: CollectionStore = { loadProject: async () => ({ ...registry.project, allowedOrigins: registry.allowedOrigins, limits: registry.limits }),
    admit: async () => true, loadRegistry: async () => registry, commit: async () => ({ accepted: 0, duplicates: 0 }),
    recordRejection: async (_id: string, _now: number, reason: Exclude<RejectionReason, 'minute_limit'>) => {
      assert.equal(reason, 'origin_denied'); calls++; await new Promise<void>(resolve => { release = resolve; }); throw Error('private-store-error');
    } };
  const logged: unknown[] = [];
  const handler = createCollector(store, { now: () => now, waitUntil: task => tasks.push(task), log: entry => logged.push(entry) });
  const response = await handler(post('{}', 'https://untrusted.example.invalid'));
  assert.equal(response.status, 403); assert.equal(calls, 1); assert.equal(tasks.length, 1);
  release!(); await Promise.all(tasks);
  assert.equal(calls, 1); assert.ok(!JSON.stringify(logged).includes('private-store-error'));
  store.admit = async () => false;
  assert.equal((await handler(post('{}'))).status, 429); assert.equal(calls, 1);
  store.admit = async () => true; store.recordRejection = async () => { throw Error('private-store-error'); };
  assert.equal((await createCollector(store, { now: () => now })(post('{}', 'https://untrusted.example.invalid'))).status, 403);
});
test('native Worker forwards its execution context to record rejected requests in actual D1', async () => {
  const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), contents:
    `import {createWorker} from './apps/collector/src/index.ts'; export default createWorker(async () => (${JSON.stringify(principal)}));` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06', d1Databases: { DB: 'rejections-runtime' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB'); for (const statement of migrationStatements()) await db.prepare(statement).run();
    await seed(db); await grant(db);
    const response = await mf.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/batches', {
      method: 'POST', headers: { Origin: registry.allowedOrigins[0]!, 'Content-Type': 'application/json' }, body: '{bad-json',
    });
    assert.equal(response.status, 400); await response.text();
    const date = new Date().toISOString().slice(0, 10);
    const result = await mf.dispatchFetch(`https://collector.example.invalid/v1/projects/sembom/collection/rejections?from=${date}&to=${date}`, {
      headers: { Authorization: 'Bearer not-a-credential' },
    });
    assert.equal(result.status, 200);
    const body = await result.json() as { summary: { reasons: { reason: string; count: number }[] } };
    assert.equal(body.summary.reasons.find(row => row.reason === 'invalid_request')?.count, 1);
  } finally { await mf.dispose(); }
});
