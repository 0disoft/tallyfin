import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { transform } from 'esbuild';
import { D1Queries } from '@tallyfin/storage-d1';
import { siteIntegration } from '../site-integration.ts';
import { prepareSite } from '../prepare-site.ts';
import { setup, now } from '../../../packages/storage-d1/test/helpers.ts';
import { FakeBrowser, deferred } from '../../../packages/browser/test/helpers.ts';
import { createCollector } from '../../../apps/collector/src/handler.ts';
import { SiteCapacityError, siteRequestJson } from '../site-capacity.ts';
import { MAX_PUBLICATION_BYTES, validateSchemaDraft } from '@tallyfin/core';
import { spawnSync } from 'node:child_process';

const example = JSON.parse(await readFile(new URL('../../../examples/independent-site/site.example.json', import.meta.url), 'utf8'));
const locales = ['en', 'zh', 'es', 'fr', 'hi', 'ko', 'ja', 'vi', 'ru', 'id', 'ms', 'th'];
const multiSite = (count: number) => ({ ...example, locales, tools: Array.from({ length: count }, (_, i) => `tool_${i}`) });
async function generatedClient(input = example) {
  const plan = siteIntegration(input);
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
    { ...example, tools: Array.from({ length: 33 }, (_, i) => `tool_${i}`) }]) assert.throws(() => siteIntegration(value));
  assert.doesNotThrow(() => siteIntegration({ ...example, locales: ['zh-hant', 'pt-br'] }));
  // Existing under-budget inputs keep their original workflow and event identifiers.
  assert.doesNotThrow(() => siteIntegration({ ...example, tools: Array.from({ length: 25 }, (_, i) => `tool_${i}`) }));
});

test('multilingual sites partition only excess tool combinations without raising schema budgets', () => {
  for (const [tools, groups, events] of [[4, 1, 5], [5, 2, 8], [32, 8, 26]]) {
    const input = multiSite(tools!), original = structuredClone(input), plan = siteIntegration(input);
    assert.deepEqual(input, original);
    assert.equal(plan.registry.workflows.length, groups); assert.equal(plan.registry.events.length, events);
    assert.equal(validateSchemaDraft(plan.draft).valid, true);
    assert.deepEqual(plan.template.workflowGroups.flatMap(group => group.tools), input.tools);
    assert.equal(plan.template.representativeWorkflowId, groups === 1 ? 'tool_usage' : null);
    assert.equal(plan.registry.representativeWorkflowId, groups === 1 ? 'tool_usage' : undefined);
    assert.equal(plan.registry.events[2]!.name, 'tool_started');
    assert.ok(plan.capacity.events.every(event => event.combinations <= 256));
    assert.equal(plan.capacity.requestedFailureCombinations, 12 * tools! * 5);
    assert.equal(plan.capacity.schemaDraftBytes, Buffer.byteLength(siteRequestJson(plan.draft)));
    assert.equal(plan.capacity.schemaPublicationBytes, Buffer.byteLength(siteRequestJson(plan.publication, MAX_PUBLICATION_BYTES)));
  }
});

test('capacity errors expose factors and prevent unusable output before file creation', async () => {
  const allLocales = Array.from({ length: 32 }, (_, i) => `en-x-${i.toString(36).padStart(2, '0')}`);
  assert.doesNotThrow(() => siteIntegration({ ...multiSite(10), locales: allLocales }));
  assert.throws(() => siteIntegration({ ...multiSite(11), locales: allLocales }), error =>
    error instanceof SiteCapacityError && error.capacity.resource === 'workflows' && error.capacity.actual === 11 && error.capacity.limit === 10);
  assert.doesNotThrow(() => siteIntegration({ ...multiSite(5), pages: Array.from({ length: 21 }, (_, i) => `page_${i}`) }));
  const overflow = { ...multiSite(5), pages: Array.from({ length: 22 }, (_, i) => `page_${i}`) };
  assert.throws(() => siteIntegration(overflow), error => error instanceof SiteCapacityError &&
    error.capacity.resource === 'page_view combinations' && error.capacity.actual === 264 && error.capacity.factors?.locale === 12);
  const longLocales = allLocales.map((_, i) => `en-x-aaaaaaaa-bbbbbbbb-${i.toString(36).padStart(2, '0')}`);
  assert.throws(() => siteIntegration({ ...multiSite(10), locales: longLocales }), error =>
    error instanceof SiteCapacityError && error.capacity.resource.includes('bytes'));
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-capacity-'));
  try {
    const input = join(directory, 'input.json'), out = join(directory, 'out');
    await writeFile(input, JSON.stringify(overflow));
    const result = spawnSync(process.execPath, [resolve('tools/runtime/prepare-site.ts'), '--file', input, '--out', out], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 1); const error = JSON.parse(result.stderr);
    assert.deepEqual(error.capacity, { resource: 'page_view combinations', actual: 264, limit: 256, factors: { locale: 12, page: 22 } });
    await assert.rejects(stat(out), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
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
    assert.equal(JSON.parse(await readFile(join(out, 'capacity-report.json'), 'utf8')).workflowCount, 1);
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
  assert.equal(client.startTool('constructor', 'en'), undefined);
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

for (const input of [example, multiSite(32)]) test(`generated ${input.tools.length}-tool site reaches protected APIs and local D1 with exact replay`, async () => {
  const f = await setup(), { plan, client } = await generatedClient(input);
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
    assert.equal(client.trackPage('tool', input.locales[0]), true); assert.equal(client.trackLanguageChange(input.locales.at(-1)), true);
    assert.equal(client.startTool(input.tools[0], input.locales[0]).succeed(), true);
    assert.equal(client.startTool(input.tools.at(-1), input.locales.at(-1)).fail({ failure_reason: 'validation' }), true);
    client.flushAnalytics(); await host.tick(0);
    const send = () => handler(new Request(plan.configuration.endpoint, { method: 'POST',
      headers: { Origin: example.allowedOrigins[0] }, body: host.calls[0]!.body }));
    assert.deepEqual(await (await send()).json(), { accepted: 6, duplicates: 0 });
    assert.deepEqual(await (await send()).json(), { accepted: 0, duplicates: 6 });
    const rows = await f.db.prepare('SELECT sum(started_count) AS started, sum(succeeded_count) AS succeeded, sum(failed_count) AS failed FROM workflow_daily_counts WHERE project_id=?').bind(example.project.id).first();
    assert.deepEqual(rows, { started: 2, succeeded: 1, failed: 1 });
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM event_receipts WHERE project_id=?').bind(example.project.id).first('n'), 6);
    const workflows = await f.db.prepare('SELECT workflow_id, sum(started_count) AS started, sum(succeeded_count) AS succeeded, sum(failed_count) AS failed FROM workflow_daily_counts WHERE project_id=? GROUP BY workflow_id ORDER BY workflow_id').bind(input.project.id).all();
    if (input.tools.length === 32) assert.deepEqual(workflows.results, [
      { workflow_id: 'tool_usage', started: 1, succeeded: 1, failed: 0 },
      { workflow_id: 'tool_usage_8', started: 1, succeeded: 0, failed: 1 },
    ]);
  } finally { client.setAnalyticsConsent(false); await f.mf.dispose(); }
});
