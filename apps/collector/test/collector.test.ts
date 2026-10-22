import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { UUID } from '@tallyfin/core';
import { migrationStatements, registry, seed } from '../../../packages/storage-d1/test/helpers.ts';
import { FakeBrowser } from '../../../packages/browser/test/helpers.ts';
import { createSembomAnalytics } from '../../../examples/sembom/browser.ts';

let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
before(async () => {
  const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname.replace(/^\/(?:([A-Z]):)/i, '$1:')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    d1Databases: { DB: 'tallyfin-http-tests' }, log: new Log(LogLevel.NONE) });
  db = await mf.getD1Database('DB');
  for (const sql of migrationStatements()) await db.prepare(sql).run();
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => {
  for (const table of ['workflow_daily_counts', 'event_daily_counts', 'ingest_daily_usage', 'ingest_minute_usage', 'workflow_attempts', 'event_receipts', 'admin_changes', 'project_grants', 'project_schemas', 'projects'])
    await db.prepare(`DELETE FROM ${table}`).run();
  await seed(db);
});
const origin = registry.allowedOrigins[0]!;
function input() {
  const start = new Date(Date.now() - 1000).toISOString();
  const attempt = { workflowId: 'calculation', attemptId: crypto.randomUUID(), startedAt: start };
  return { schemaVersion: 1, source: 'browser', events: [
    { eventId: crypto.randomUUID(), name: 'input_start', occurredAt: start, properties: { tool: 'loan' }, attempt },
    { eventId: crypto.randomUUID(), name: 'calculation_success', occurredAt: new Date().toISOString(), properties: { tool: 'loan' }, attempt },
  ] };
}
const send = (body: string | Uint8Array, headers: Record<string, string> = {}, path = '/v1/projects/sembom/batches') => mf.dispatchFetch(`https://collector.example.invalid${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body,
});
async function checkError(response: Awaited<ReturnType<typeof send>>, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json() as { error: { code: string; message: string; requestId: string } };
  assert.equal(body.error.code, code); assert.match(body.error.requestId, UUID);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'requestId']);
  assert.ok(body.error.message.length <= 160);
}
test('real Worker with D1 accepts JSON and exact retry without duplicate count', async () => {
  const b = JSON.stringify(input()); const first = await send(b);
  assert.equal(first.status, 200); assert.deepEqual(await first.json(), { accepted: 2, duplicates: 0 });
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(first.headers.get('Vary'), 'Origin'); assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.equal(first.headers.get('Access-Control-Allow-Credentials'), null); assert.equal(first.headers.get('Set-Cookie'), null);
  assert.deepEqual(await (await send(b)).json(), { accepted: 0, duplicates: 2 });
  assert.equal(await db.prepare('SELECT sum(count) AS count FROM event_daily_counts').first('count'), 2);
});
test('Beacon text/plain uses the same JSON validation', async () => {
  assert.equal((await send(JSON.stringify(input()), { 'Content-Type': 'text/plain; charset=utf-8' })).status, 200);
  await checkError(await send('free text', { 'Content-Type': 'text/plain' }), 400, 'invalid_request');
});

test('Sembom SDK example delivers a workflow through the Worker into D1 without duplicate counts', async () => {
  const host = new FakeBrowser(); host.time = Date.now();
  let delivery: Promise<Awaited<ReturnType<typeof send>>> | undefined;
  host.reply = async index => {
    delivery = send(host.calls[index]!.body, { 'Content-Type': 'text/plain;charset=utf-8' });
    const response = await delivery;
    return { status: response.status, retryAfter: response.headers.get('Retry-After') };
  };
  const disabled = createSembomAnalytics('https://collector.example.invalid/v1/projects/sembom/batches', false, host);
  assert.equal(disabled.view('loan'), false); assert.equal(host.listeners.size, 0);
  const analytics = createSembomAnalytics('https://collector.example.invalid/v1/projects/sembom/batches', true, host);
  try {
    assert.equal(analytics.view('loan'), true);
    const attempt = analytics.startInput('loan'); assert.ok(attempt);
    assert.equal(analytics.validationError('loan', 'required'), true);
    assert.equal(attempt.succeed(), true); assert.equal(attempt.succeed(), false);
    assert.equal(analytics.resultCopied('loan'), true);
    assert.equal(analytics.feedbackSubmitted('loan'), true);
    analytics.flush(); await host.tick(0); assert.ok(delivery);
    assert.deepEqual(await (await delivery).json(), { accepted: 6, duplicates: 0 });
    assert.deepEqual(await (await send(host.calls[0]!.body)).json(), { accepted: 0, duplicates: 6 });
    assert.equal(await db.prepare('SELECT sum(count) AS count FROM event_daily_counts').first('count'), 6);
    assert.deepEqual(await db.prepare('SELECT started_count, succeeded_count, failed_count FROM workflow_daily_counts').first(),
      { started_count: 1, succeeded_count: 1, failed_count: 0 });
  } finally { analytics.destroy(); disabled.destroy(); }
});
for (const denied of ['', 'null', 'https://sembom.example.invalid.evil.invalid', `${origin}/`, 'https://evil.invalid'])
  test(`origin denied: ${denied || 'missing'}`, async () => {
    const response = await send(JSON.stringify(input()), { Origin: denied });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    await checkError(response, 403, 'origin_denied');
    assert.equal(await db.prepare('SELECT count(*) AS count FROM event_receipts').first('count'), 0);
    assert.equal(await db.prepare('SELECT count(*) FROM ingest_minute_usage').first('count(*)'), 0);
  });
test('paused and unknown project are unavailable', async () => {
  await db.prepare("UPDATE projects SET status='paused'").run();
  await checkError(await send(JSON.stringify(input())), 403, 'project_unavailable');
  await checkError(await send(JSON.stringify(input()), {}, '/v1/projects/unknown/batches'), 404, 'not_found');
});
test('unknown version and unknown event reject the whole batch', async () => {
  const b = input(); b.schemaVersion = 2;
  await checkError(await send(JSON.stringify(b)), 422, 'unknown_schema');
  b.schemaVersion = 1; b.events[1]!.name = 'not_registered';
  await checkError(await send(JSON.stringify(b)), 422, 'invalid_event');
  assert.equal(await db.prepare('SELECT count(*) AS count FROM event_receipts').first('count'), 0);
});
test('CORS preflight allows POST and content-type only', async () => {
  const preflight = (headers = {}) => mf.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/batches', { method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type', ...headers } });
  const response = await preflight(); assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  await checkError(await preflight({ 'Access-Control-Request-Headers': 'authorization' }), 400, 'invalid_request');
  await checkError(await preflight({ 'Access-Control-Request-Method': 'GET' }), 400, 'invalid_request');
});
test('unsupported MIME, charset and compressed payloads are rejected', async () => {
  for (const headers of [{ 'Content-Type': 'text/html' }, { 'Content-Type': 'application/json; charset=latin1' }, { 'Content-Encoding': 'gzip' }])
    await checkError(await send(JSON.stringify(input()), headers), 415, 'invalid_request');
});
test('body limit counts UTF-8 bytes and rejects oversized streamed bodies', async () => {
  await checkError(await send('가'.repeat(6000)), 413, 'invalid_request');
  await checkError(await send(' '.repeat(16384) + '{}'), 413, 'invalid_request');
});
test('malformed UTF-8 and malformed JSON are rejected', async () => {
  await checkError(await send(new Uint8Array([0x7b, 0xc0, 0xaf, 0x7d])), 400, 'invalid_request');
  await checkError(await send('{'), 400, 'invalid_request');
});
test('minute quota includes malformed requests and duplicate retransmissions', async () => {
  await db.prepare('UPDATE projects SET requests_per_minute = 2').run();
  const b = JSON.stringify(input()); assert.equal((await send(b)).status, 200);
  await checkError(await send('{'), 400, 'invalid_request');
  const limited = await send(b);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.ok(Number(limited.headers.get('Retry-After')) <= 60);
  await checkError(limited, 429, 'quota_exceeded');
});
test('daily budget rejects the entire batch', async () => {
  await db.prepare('UPDATE projects SET new_receipts_per_utc_day = 1').run();
  await checkError(await send(JSON.stringify(input())), 429, 'quota_exceeded');
  assert.equal(await db.prepare('SELECT count(*) AS count FROM event_receipts').first('count'), 0);
});
test('conflicting ID and database failure return stable errors with no raw payload or SQL', async () => {
  const b = input(); assert.equal((await send(JSON.stringify(b))).status, 200);
  b.events[0]!.properties.tool = 'timer';
  await checkError(await send(JSON.stringify(b)), 409, 'event_conflict');
  await db.prepare('DROP TABLE ingest_minute_usage').run();
  const unavailable = await send(JSON.stringify(input()));
  assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('Retry-After'), '1');
  const error = await unavailable.text(); assert.ok(!error.includes('ingest_minute_usage')); assert.ok(!error.includes('properties'));
  // Restore the table for the remaining cases.
  await db.prepare(migrationStatements().find(sql => sql.startsWith('CREATE TABLE ingest_minute_usage'))!).run();
});
test('administrator endpoints remain closed and unknown routes do not expose data', async () => {
  const response = await mf.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/summary', { headers: { Authorization: 'Bearer not-a-credential' } });
  await checkError(response, 401, 'unauthorized');
  await checkError(await mf.dispatchFetch('https://collector.example.invalid/unknown'), 404, 'not_found');
});
