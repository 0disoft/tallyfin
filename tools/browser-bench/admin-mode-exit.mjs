import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { answerConfirm } from './answer-confirm.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, directory, watchdog, stage = 'arguments';
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-mode-exit -- [--channel chromium|chrome|msedge]\nActual /demo API exit confirmation with ephemeral signed authority and isolated local D1; no remote service.');
  else {
    watchdog = setTimeout(() => { void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true }); directory = await mkdtemp(resolve(root, '.tmp/admin-mode-exit-'));
    stage = 'fixture'; local = await adminLoginFixture(directory, { profile: 'access' });
    const collector = new URL(await local.mf.ready).origin, previous = process.env.TALLYFIN_COLLECTOR_ORIGIN;
    delete process.env.TALLYFIN_COLLECTOR_ORIGIN;
    try {
      server = await createServer({ root: resolve(root, 'apps/admin'), configFile: resolve(root, 'apps/admin/vite.config.mjs'),
        envDir: false, envPrefix: [], cacheDir: resolve(directory, 'vite-cache'), logLevel: 'error',
        define: Object.fromEntries(Object.entries({ VITE_OIDC_ISSUER: local.issuer, VITE_OIDC_CLIENT_ID: local.clientId,
          VITE_OIDC_SCOPE: 'openid offline_access', VITE_OIDC_RESOURCE: local.resource, VITE_OIDC_ID_TOKEN_ALG: 'RS256' })
          .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
        server: { host: '127.0.0.1', port: 0, proxy: { '^/v1(?:/|\\?|$)': { target: collector, changeOrigin: false } } },
      });
    } finally { if (previous === undefined) delete process.env.TALLYFIN_COLLECTOR_ORIGIN; else process.env.TALLYFIN_COLLECTOR_ORIGIN = previous; }
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
    browser = await chromium.launch({ channel: values.channel, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    let pageErrors = 0, routeError = false;
    await context.route('**/*', async route => {
      try { await local.route(route); } catch { routeError = true; await route.abort().catch(() => {}); }
    });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', () => pageErrors++);
    stage = 'signed-authority'; await page.goto(origin);
    const tokenResponse = page.waitForResponse(response => response.url() === `${local.issuer}/token`).catch(() => null);
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    const response = await tokenResponse; assert.ok(response);
    let bearer = (await response.json()).access_token; assert.equal(typeof bearer, 'string');
    stage = 'demo-manual-connect'; await page.goto(`${origin}/demo`);
    const modes = page.getByRole('group', { name: '데이터 모드', exact: true });
    const api = modes.getByRole('button', { name: 'API 연결', exact: true }), sample = modes.getByRole('button', { name: 'Sample', exact: true });
    await api.click(); await page.getByText('관리자 토큰으로 직접 연결', { exact: true }).click();
    await page.locator('#api-token').fill(bearer); bearer = null;
    await page.getByRole('button', { name: '연결', exact: true }).click();
    const project = page.getByRole('combobox', { name: '프로젝트 선택', exact: true });
    await project.selectOption('sembom');
    const navigation = page.getByRole('navigation', { name: '주요 탐색', exact: true });
    await navigation.getByRole('button', { name: '설정', exact: true }).click();
    const name = page.locator('#settings-name'), label = page.locator('#schema-event-0-label');
    await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === false && document.getElementById('schema-event-0-label')?.disabled === false);
    const initialName = (await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name;
    await name.fill('Mode exit draft'); await label.fill('Mode exit schema');
    const noDialog = async action => {
      let unexpected = false;
      const dismiss = async dialog => { unexpected = true; await dialog.dismiss(); };
      page.on('dialog', dismiss);
      try { await action(); assert.equal(unexpected, false); }
      finally { page.off('dialog', dismiss); }
    };
    stage = 'same-mode'; await noDialog(() => api.click());
    assert.equal(await name.inputValue(), 'Mode exit draft'); assert.equal(await label.inputValue(), 'Mode exit schema');
    await navigation.getByRole('button', { name: '이벤트 분석', exact: true }).click();
    assert.equal(await name.isVisible(), false);
    stage = 'hidden-mode-cancel'; await answerConfirm(page, () => sample.click(), false);
    assert.equal(await api.getAttribute('aria-pressed'), 'true'); assert.equal(await project.inputValue(), 'sembom');
    assert.equal(await name.inputValue(), 'Mode exit draft'); assert.equal(await label.inputValue(), 'Mode exit schema');
    assert.equal(await page.getByRole('button', { name: '관리자 로그인', exact: true }).count(), 0);
    stage = 'draft-return'; await navigation.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).click();
    await page.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).click();
    assert.equal(await name.isEditable(), true); assert.equal(await label.isEditable(), true);
    assert.equal(await name.inputValue(), 'Mode exit draft'); assert.equal(await label.inputValue(), 'Mode exit schema');
    stage = 'mode-accept'; await answerConfirm(page, () => sample.click(), true);
    assert.equal(await sample.getAttribute('aria-pressed'), 'true');
    assert.equal(await name.count(), 0); assert.equal(await label.count(), 0);
    stage = 'api-reentry'; await api.click(); await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('#api-token').inputValue(), ''); assert.equal(await project.count(), 0);
    assert.equal(await name.count(), 0); assert.equal(await label.count(), 0);
    stage = 'clean-exit'; await noDialog(() => sample.click());
    assert.equal(await sample.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0); assert.equal(local.counts.apiWrites, 0);
    assert.equal((await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name, initialName);
    assert.equal(pageErrors, 0); assert.equal(routeError, false);
    const report = { verified: true, browser: browser.version(), signedManualDemoConnection: true, hiddenDraftExitCanceled: true,
      canceledModeRetainsDraftsAndSelection: true, acceptedModeDisposesApiWorkspace: true, apiReentryRequiresConnection: true,
      sameModeAndCleanExitDoNotWarn: true, noStorageOrCookie: true, pageErrors, routeError, ...local.counts };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  }
} catch {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, code: 'admin_mode_exit_failed', counts: local?.counts }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, code: 'admin_mode_exit_failed' }));
} finally {
  clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose();
}
