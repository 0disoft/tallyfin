import { BROWSER_SIZE_BUDGET } from '../../../../tools/browser/size-policy.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { sdkSetup, sdkFunnels } from './sdk-setup.ts';
import { projectBrowserSchema, projectFunnelBrowserSchema } from '../../../../tools/browser/schema.mjs';
import { projectServerSchema } from '../../../../tools/server/schema.mjs';
import { FakeBrowser } from '../../../../packages/browser/test/helpers.ts';

const registry = () => JSON.parse(readFileSync(new URL('../../../../api/examples/funnel-registry.json', import.meta.url), 'utf8'));
const endpoint = 'https://collector.example.invalid';
const projected = (code, source) => JSON.parse(code.split('    schema: ')[1].split(source === 'server' ? ',\n    getToken' : ',\n  }, host);')[0]);
async function load(code, source) {
  const path = source === 'server' ? '../../../../packages/server/src/index.ts' : '../../../../packages/browser/src/funnels.ts';
  const name = source === 'server' ? '@tallyfin/server' : '@tallyfin/browser/funnels';
  const result = await transform(code, { loader: 'ts', format: 'esm', target: 'es2023' });
  return import('data:text/javascript;base64,' + Buffer.from(result.code.replace(name, new URL(path, import.meta.url).href)).toString('base64'));
}

test('browser profile selection preserves legacy setup and matches the reviewed optional projection', () => {
  const r = registry();
  r.events.push(...['legacy_start', 'legacy_done', 'ordinary'].map(name => ({ name, label: name, source: 'browser', properties: {} })));
  r.workflows.push({ id: 'legacy', label: 'legacy', source: 'browser', startEvent: 'legacy_start', successEvent: 'legacy_done', failureEvent: null, dimensions: [] });
  const ordinary = sdkSetup(r, endpoint);
  assert.deepEqual(JSON.parse(ordinary.split('  schema: ')[1].split(',\n});')[0]), projectBrowserSchema(r));
  const linked = sdkSetup(r, endpoint, 'browser', { profile: 'funnels', funnelId: 'conversion' });
  assert.deepEqual(projected(linked, 'browser'), projectFunnelBrowserSchema(r));
  assert.ok(linked.includes("from '@tallyfin/browser/funnels'"));
  assert.ok(!linked.includes('legacy_start')); assert.ok(!linked.includes('job_started')); assert.ok(!linked.includes('job_finished'));
  assert.ok(!linked.includes('Reviewed')); assert.ok(!linked.includes('Authorization'));
  assert.ok(linked.includes('analytics.trackFunnel("file_selected"')); assert.ok(linked.includes('run.startedAt'));
  assert.ok(linked.includes('원래 occurredAt')); assert.ok(linked.includes('연결 정보는 인증 수단이 아니에요'));
  assert.ok(sdkSetup(r, 'http://localhost:5188', 'browser', { profile: 'funnels' }).includes('allowLocalHttp: true'));
});

test('server setup includes its complete optional funnel projection while omitting browser stage names', () => {
  const r = registry(), code = sdkSetup(r, endpoint, 'server', { funnelId: 'conversion' });
  assert.deepEqual(projected(code, 'server'), projectServerSchema(r));
  assert.ok(!code.includes('file_selected')); assert.ok(!code.includes('upload_finished'));
  assert.ok(code.includes('validatedTaskContext.funnel'));
  assert.ok(!code.includes('analytics.createFunnelRun('));
  assert.ok(code.includes('{ funnel: run, occurredAt: occurredAt2 }'));
  assert.ok(code.includes('await analytics.send([event3])'));
  assert.ok(code.includes('서버 이벤트는 eventId도 유지'));
});

test('generated factories load the real browser and server SDKs and forward the same task without eager collection', async () => {
  const r = registry(), host = new FakeBrowser();
  const browserModule = await load(sdkSetup(r, endpoint, 'browser', { profile: 'funnels' }), 'browser');
  const browser = browserModule.connectBrowserAnalytics(host);
  const run = browser.createFunnelRun('conversion');
  assert.ok(run); assert.equal(host.calls.length, 0); assert.equal(browser.pending, 0);
  assert.equal(browser.trackFunnel('file_selected', { kind: 'pdf' }, run), true);
  host.time += 10; assert.equal(browser.trackFunnel('upload_finished', { kind: 'pdf' }, run), true);
  browser.flush(); await host.tick(0);
  const browserEvents = JSON.parse(host.calls[0].body).events;
  assert.deepEqual(browserEvents.map(event => event.funnel), [run, run]);
  assert.equal(browserEvents[0].occurredAt, run.startedAt);
  let tokens = 0; const sent = [];
  const serverModule = await load(sdkSetup(r, endpoint, 'server'), 'server');
  const server = serverModule.connectServerAnalytics(() => { tokens++; return 'not-a-credential'; }, {
    now: () => host.time, monotonicNow: () => 0, uuid: () => crypto.randomUUID(), wait: async () => {},
    fetch: async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ accepted: 1, duplicates: 0 }); },
  });
  host.time += 10;
  const event = server.createEvent('job_finished', { kind: 'pdf' }, { funnel: run });
  assert.deepEqual(event.funnel, run); assert.equal(tokens, 0); assert.equal(sent.length, 0);
  assert.equal((await server.send([event])).status, 'delivered'); assert.equal(tokens, 1);
  assert.deepEqual(sent[0].events[0].funnel, run); browser.destroy();
});

test('server-first and single-source examples create tasks only in the registered first source', async () => {
  const r = registry();
  r.funnels[0].steps = [r.funnels[0].steps[2], r.funnels[0].steps[0], r.funnels[0].steps[3]];
  const browserCode = sdkSetup(r, endpoint, 'browser', { profile: 'funnels' });
  assert.ok(browserCode.includes('validatedTaskContext.funnel')); assert.ok(!browserCode.includes('analytics.createFunnelRun('));
  const serverCode = sdkSetup(r, endpoint, 'server');
  assert.ok(serverCode.includes('analytics.createFunnelRun("conversion")'));
  assert.ok(serverCode.includes('const occurredAt0 = run.startedAt;'));
  const host = new FakeBrowser(), module = await load(browserCode, 'browser'), client = module.connectBrowserAnalytics(host);
  assert.equal(client.createFunnelRun('conversion'), undefined); client.destroy();
  r.funnels[0].steps = r.funnels[0].steps.filter(step => step.source === 'server');
  assert.deepEqual(sdkFunnels(r, 'browser'), []); assert.equal(sdkFunnels(r, 'server').length, 1);
  assert.throws(() => sdkSetup(r, endpoint, 'browser', { profile: 'funnels' }), /등록 퍼널/);
  assert.deepEqual(projected(sdkSetup(r, endpoint, 'server'), 'server'), projectServerSchema(r));
});

test('unknown profiles, stale or foreign funnel selections and missing source permissions reject setup', () => {
  const r = registry();
  assert.throws(() => sdkSetup(r, endpoint, 'browser', { profile: 'all' }), /SDK 종류/);
  assert.throws(() => sdkSetup(r, endpoint, 'browser', { profile: 'funnels', funnelId: 'missing' }), /선택한 퍼널/);
  assert.throws(() => sdkSetup(r, endpoint, 'browser', { funnelId: 'conversion' }), /선택한 퍼널/);
  assert.throws(() => sdkSetup({ ...r, allowedOrigins: [] }, endpoint, 'browser', { profile: 'funnels' }), /허용 출처/);
  assert.throws(() => sdkSetup({ ...r, schemaStatus: 'retired' }, endpoint, 'server'), /사용 중/);
  assert.throws(() => sdkSetup({ ...r, funnels: [] }, endpoint, 'server', { profile: 'funnels' }), /등록 퍼널/);
});

test('the generated browser factory with its endpoint and schema fits the SDK integration budget', async () => {
  const code = sdkSetup(registry(), endpoint, 'browser', { profile: 'funnels' });
  const result = await build({ stdin: { contents: code, loader: 'ts', resolveDir: fileURLToPath(new URL('../../../../', import.meta.url)) },
    bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022', mangleProps: /^__tfBatch/,
    plugins: [{ name: 'local-sdk-source', setup(builder) {
      builder.onResolve({ filter: /^@tallyfin\/browser\/funnels$/ }, () => ({
        path: fileURLToPath(new URL('../../../../packages/browser/src/funnels.ts', import.meta.url)),
      }));
    } }] });
  const gzipBytes = gzipSync(result.outputFiles[0].contents).length;
  assert.ok(gzipBytes <= BROWSER_SIZE_BUDGET.integration, `Generated SDK integration is ${gzipBytes} gzip bytes; budget is ${BROWSER_SIZE_BUDGET.integration}`);
});
