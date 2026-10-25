import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { transform } from 'esbuild';
import { D1Queries } from '@tallyfin/storage-d1';
import { siteIntegration } from '../site-integration.ts';
import { prepareSite } from '../prepare-site.ts';
import { setup, now } from '../../../packages/storage-d1/test/helpers.ts';
import { FakeBrowser, deferred } from '../../../packages/browser/test/helpers.ts';
import { createCollector } from '../../../apps/collector/src/handler.ts';

const example = JSON.parse(await readFile(new URL('../../../examples/independent-site/site.example.json', import.meta.url), 'utf8'));
async function generatedClient() {
  const plan = siteIntegration(example);
  const source = plan.module.replace("'@tallyfin/browser'", JSON.stringify(new URL('../../../packages/browser/src/index.ts', import.meta.url).href));
  const compiled = await transform(source, { loader: 'ts', format: 'esm' });
  return { plan, client: await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}#${crypto.randomUUID()}`) };
}

test('site preparation preserves input and emits a disabled, unregistered source-specific configuration', () => {
  const original = structuredClone(example), plan = siteIntegration(example);
  assert.deepEqual(example, original); assert.equal(plan.configuration.enabled, false);
  assert.equal(plan.template.registrationVerified, false); assert.equal(plan.publication.privacyReviewed, false);
  assert.deepEqual(plan.template.csp.connectSrcOrigins, [example.collectorOrigin]);
  assert.equal(plan.configuration.endpoint, `${example.collectorOrigin}/v1/projects/${example.project.id}/batches`);
  assert.deepEqual(plan.requests.map(item => item.method), ['POST', 'POST', 'PUT', 'GET']);
  for (const value of [{ ...example, token: 'must-reject' }, { ...example, locales: ['en', 'en'] },
    { ...example, locales: ['EN'] }, { ...example, locales: ['zh-Hant'] }, { ...example, locales: ['not_a_locale'] },
    { ...example, allowedOrigins: [] }, { ...example, allowedOrigins: ['https://*.example.invalid'] },
    { ...example, collectorOrigin: example.collectorOrigin + '/' }, { ...example, collectorOrigin: 'http://remote.invalid' },
    { ...example, collectorOrigin: example.collectorOrigin + '/?token=private' },
    { ...example, pages: ['https://private.invalid/path'] },
    { ...example, tools: Array.from({ length: 26 }, (_, i) => `tool_${i}`) }]) assert.throws(() => siteIntegration(value));
  assert.doesNotThrow(() => siteIntegration({ ...example, locales: ['zh-hant', 'pt-br'] }));
  // 2 locales * 25 tools * 5 failure classes = 250 combinations; the next tool exceeds 256.
  assert.doesNotThrow(() => siteIntegration({ ...example, tools: Array.from({ length: 25 }, (_, i) => `tool_${i}`) }));
});

test('site CLI writes new public files only and rejects overwrite, credentials, remote flags and oversized input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-site-'));
  try {
    const file = join(directory, 'input.json'), out = join(directory, 'site');
    await writeFile(file, JSON.stringify(example));
    const report = await prepareSite(['--file', file, '--out', out]);
    assert.equal('remoteChanges' in report && report.remoteChanges, false);
    assert.equal(JSON.parse(await readFile(join(out, 'browser-config.json'), 'utf8')).enabled, false);
    await assert.rejects(prepareSite(['--file', file, '--out', out]));
    await assert.rejects(prepareSite(['--file', file, '--out', out, '--apply']));
    await writeFile(file, JSON.stringify({ ...example, token: 'private-value' }));
    await assert.rejects(prepareSite(['--file', file, '--out', join(directory, 'bad')]));
    await writeFile(file, ' '.repeat(16385));
    await assert.rejects(prepareSite(['--file', file, '--out', join(directory, 'large')]));
    assert.equal(JSON.parse(await readFile(join(out, 'template-config.json'), 'utf8')).registrationVerified, false);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
  }
});

test('generated consent wrapper uses the real SDK, freezes attempt locale and cancels in-flight delivery on withdrawal', async () => {
  const { client } = await generatedClient(), host = new FakeBrowser();
  assert.equal(client.trackPage('home', 'en'), false); assert.equal(host.listeners.size, 0);
  client.setAnalyticsConsent(true, host); client.setAnalyticsConsent(true, host);
  assert.equal(host.listeners.size, 1);
  assert.equal(client.trackPage('home', 'EN'), false); assert.equal(client.trackLanguageChange('fr'), false);
  const attempt = client.startTool('calculator', 'en'); assert.ok(attempt);
  assert.equal(client.trackLanguageChange('ko'), true); assert.equal(attempt.succeed(), true);
  client.flushAnalytics(); await host.tick(0);
  const events = JSON.parse(host.calls[0]!.body).events;
  assert.deepEqual(events.filter((event: any) => event.attempt).map((event: any) => event.properties.locale), ['en', 'en']);
  const pending = deferred(); host.reply = () => pending.promise;
  const old = client.startTool('converter', 'ko'); client.flushAnalytics(); await host.tick(0);
  assert.equal(host.calls.length, 2); client.setAnalyticsConsent(false);
  assert.equal(host.calls[1]!.signal.aborted, true); assert.equal(old.succeed(), false);
  assert.equal(host.listeners.size, 0); assert.equal(host.timers.size, 0); assert.equal(client.trackPage('home', 'en'), false);
  pending.resolve({ status: 200, retryAfter: null });
  client.setAnalyticsConsent(true, host); assert.equal(host.listeners.size, 1);
  client.setAnalyticsConsent(false);
});

test('generated registration requests and SDK batches work through existing protected APIs and real local D1 with exact replay', async () => {
  const f = await setup(), { plan, client } = await generatedClient();
  const principal = { issuer: 'https://issuer.example.invalid', subject: 'site-creator' };
  try {
    await f.db.prepare('INSERT INTO project_creators VALUES (?,?,2,?)').bind(principal.issuer, principal.subject, now).run();
    const handler = createCollector(f.store, { now: () => now, admin: { store: new D1Queries(f.db), verifyBearer: async () => principal } });
    const request = (url: string, method: string, value?: unknown) => handler(new Request(url,
      { method, headers: { Authorization: 'Bearer local-test-only', 'Content-Type': 'application/json' },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }) }));
    assert.equal((await request(plan.requests[0]!.url, 'POST', plan.creation)).status, 200);
    assert.equal((await (await request(plan.requests[1]!.url, 'POST', plan.draft)).json()).valid, true);
    assert.equal((await request(plan.requests[2]!.url, 'PUT', plan.publication)).status, 400);
    assert.equal((await request(plan.requests[2]!.url, 'PUT', { ...plan.publication, privacyReviewed: true })).status, 200);
    assert.equal((await request(plan.requests[3]!.url, 'GET')).status, 200);
    const host = new FakeBrowser(); client.setAnalyticsConsent(true, host);
    assert.equal(client.trackPage('tool', 'en'), true); assert.equal(client.trackLanguageChange('ko'), true);
    assert.equal(client.startTool('calculator', 'en').succeed(), true);
    assert.equal(client.startTool('converter', 'ko').fail({ failure_reason: 'validation' }), true);
    client.flushAnalytics(); await host.tick(0);
    const send = () => handler(new Request(plan.configuration.endpoint, { method: 'POST',
      headers: { Origin: example.allowedOrigins[0] }, body: host.calls[0]!.body }));
    assert.deepEqual(await (await send()).json(), { accepted: 6, duplicates: 0 });
    assert.deepEqual(await (await send()).json(), { accepted: 0, duplicates: 6 });
    const rows = await f.db.prepare('SELECT sum(started_count) AS started, sum(succeeded_count) AS succeeded, sum(failed_count) AS failed FROM workflow_daily_counts WHERE project_id=?').bind(example.project.id).first();
    assert.deepEqual(rows, { started: 2, succeeded: 1, failed: 1 });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts WHERE project_id=?').bind(example.project.id).first('n'), 6);
  } finally { client.setAnalyticsConsent(false); await f.mf.dispose(); }
});
