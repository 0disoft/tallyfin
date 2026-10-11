import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, watchdog, directory, stage = 'arguments', sdkBundle;
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' },
    'lost-responses': { type: 'boolean', default: false }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-onboarding -- [--channel chromium|chrome|msedge] [--lost-responses]\nLocal signed login, empty-project onboarding, generated browser SDK and real D1 count; no remote service.\n--lost-responses loses creation/publication responses after real commits and verifies explicit recovery.');
  else {
    watchdog = setTimeout(() => { void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true });
    directory = await mkdtemp(resolve(root, '.tmp/admin-onboarding-'));
    stage = 'fixture'; local = await adminLoginFixture(directory, { profile: 'onboarding' });
    const collector = new URL(await local.mf.ready).origin;
    const previous = process.env.TALLYFIN_COLLECTOR_ORIGIN;
    delete process.env.TALLYFIN_COLLECTOR_ORIGIN;
    try {
      server = await createServer({ root: resolve(root, 'apps/admin'), configFile: resolve(root, 'apps/admin/vite.config.mjs'),
        envDir: false, envPrefix: [], cacheDir: resolve(directory, 'vite-cache'), logLevel: 'error',
        define: Object.fromEntries(Object.entries({ VITE_OIDC_ISSUER: local.issuer, VITE_OIDC_CLIENT_ID: local.clientId,
          VITE_OIDC_SCOPE: 'openid offline_access', VITE_OIDC_RESOURCE: local.resource, VITE_OIDC_ID_TOKEN_ALG: 'RS256' })
          .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
        server: { host: '127.0.0.1', port: 0, proxy: { '^/v1(?:/|\\?|$)': { target: collector, changeOrigin: false } } },
        plugins: [{ name: 'onboarding-sdk-test', configureServer(vite) { vite.middlewares.use((req, res, next) => {
          if (req.url !== '/onboarding-sdk.js') return next();
          assert.ok(sdkBundle); res.setHeader('content-type', 'text/javascript'); res.end(sdkBundle);
        }); } }],
      });
    } finally { if (previous === undefined) delete process.env.TALLYFIN_COLLECTOR_ORIGIN; else process.env.TALLYFIN_COLLECTOR_ORIGIN = previous; }
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
    browser = await chromium.launch({ channel: values.channel, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    let routeError = false, pageErrors = 0;
    const dropped = { creation: 0, publication: 0 };
    await context.route('**/*', async route => { try {
      const request = route.request(), url = new URL(request.url());
      const kind = values['lost-responses'] && url.origin === origin
        ? request.method() === 'POST' && url.pathname === '/v1/projects' ? 'creation'
          : request.method() === 'PUT' && url.pathname === '/v1/projects/onboarding-test/schemas/1' ? 'publication' : null
        : null;
      const dropResponse = kind !== null && dropped[kind] === 0;
      if (dropResponse) dropped[kind]++;
      await local.route(route, { dropResponse });
    } catch { routeError = true; await route.abort(); } });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', () => pageErrors++);
    stage = 'login'; await page.goto(origin);
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '접근 가능한 프로젝트가 없어요', exact: true }).waitFor();
    stage = 'create'; await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click();
    await page.locator('#create-name').fill('Onboarding test');
    await page.locator('#create-id').fill('onboarding-test');
    await page.locator('#create-timeZone').fill('Asia/Seoul');
    await page.locator('#create-origins').fill(origin);
    await page.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
    if (values['lost-responses']) {
      stage = 'creation-response-recovery';
      const confirm = page.getByRole('button', { name: '같은 요청으로 생성 확인', exact: true });
      await confirm.waitFor();
      assert.equal(local.counts.apiWrites, 1);
      assert.equal(await page.locator('#create-id').inputValue(), 'onboarding-test');
      assert.equal(await page.locator('#create-name').inputValue(), 'Onboarding test');
      assert.equal(await page.locator('#create-id').isDisabled(), true);
      assert.equal((await local.db.prepare("SELECT count(*) AS n FROM projects WHERE id = ?").bind('onboarding-test').first()).n, 1);
      await confirm.click();
    }
    await page.getByRole('heading', { name: '프로젝트 생성을 확인했어요', exact: true }).waitFor();
    stage = 'schema'; await page.locator('#schema-event-add:not([disabled])').click();
    await page.locator('#schema-event-0-name').fill('action_complete');
    await page.locator('#schema-event-0-label').fill('Action complete');
    await page.getByRole('button', { name: '정의 검증', exact: true }).click();
    await page.getByRole('checkbox', { name: '정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.', exact: true }).check();
    await page.getByRole('button', { name: '새 버전 발행 (v1)', exact: true }).click();
    if (values['lost-responses']) {
      stage = 'publication-response-recovery';
      const check = page.getByRole('button', { name: '서버 상태 확인', exact: true });
      await check.waitFor();
      assert.equal(local.counts.apiWrites, 4);
      assert.equal(await page.locator('#schema-event-0-name').inputValue(), 'action_complete');
      assert.equal(await page.locator('#schema-event-0-name').isEditable(), false);
      await check.click();
      await page.getByText('v1 발행을 서버에서 확인했어요. 입력한 정의는 그대로 뒀어요.', { exact: true }).waitFor();
      assert.equal(local.counts.apiWrites, 4);
      assert.equal(await page.locator('#schema-event-0-name').inputValue(), 'action_complete');
      assert.equal(await page.locator('#schema-version').inputValue(), '2');
      assert.equal(await page.getByRole('checkbox', { name: '정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.', exact: true }).isChecked(), false);
    }
    stage = 'sdk'; await page.locator('#sdk-origin').fill(origin);
    const snippet = await page.getByRole('textbox', { name: '브라우저 SDK 연결 코드', exact: true }).inputValue();
    // Compile exactly the UI-generated connection code against the freshly built local SDK.
    const compiled = await build({ stdin: { contents: snippet + '\nwindow.onboardingAnalytics = analytics;', loader: 'ts', resolveDir: root },
      bundle: true, format: 'esm', platform: 'browser', write: false });
    sdkBundle = compiled.outputFiles[0].text;
    await page.evaluate(async () => {
      await import('/onboarding-sdk.js');
      if (!window.onboardingAnalytics.track('action_complete', {})) throw Error('Generated SDK rejected registered event');
      window.onboardingAnalytics.flush();
    });
    const count = async () => (await local.db.prepare("SELECT coalesce(sum(count),0) AS n FROM event_daily_counts WHERE project_id = ? AND event_name = ? AND schema_version = 1 AND source = 'browser'")
      .bind('onboarding-test', 'action_complete').first()).n;
    const until = Date.now() + 10000;
    while (await count() !== 1 && Date.now() < until) await new Promise(done => setTimeout(done, 50));
    assert.equal(await count(), 1);
    await page.evaluate(() => window.onboardingAnalytics.destroy());
    stage = 'onboarding-step';
    await page.waitForFunction(() => document.querySelector('.project-onboarding li[aria-current="step"]')?.textContent === '3 SDK 연결');
    const step = await page.locator('.project-onboarding li[aria-current="step"]').innerText();
    console.log(JSON.stringify({ observedOnboardingStep: step }));
    assert.equal(step, '3 SDK 연결');
    stage = 'query'; await page.getByRole('button', { name: '이벤트 분석', exact: true }).click();
    await page.getByRole('button', { name: 'action_complete', exact: true }).waitFor();
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'action_complete', exact: true }) });
    assert.equal(await row.locator('.number-cell').innerText(), '1');
    assert.equal(routeError, false); assert.equal(pageErrors, 0);
    assert.equal(local.counts.browserBatches, 1);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0);
    if (values['lost-responses']) assert.deepEqual(dropped, { creation: 1, publication: 1 });
    const report = { verified: true, browser: browser.version(), emptyProjectCreated: true, schemaPublished: true,
      generatedSdkExecuted: true, firstEventCount: await count(), correctOnboardingStep: true, eventVisible: true,
      lostResponseRecovery: values['lost-responses'], droppedResponses: dropped,
      routeError, pageErrors, ...local.counts };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
} catch (error) {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, code: 'admin_onboarding_failed', counts: local?.counts }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, code: 'admin_onboarding_failed' }));
} finally {
  clearTimeout(watchdog);
  await browser?.close(); await server?.close(); await local?.mf.dispose();
}
