import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let stage = 'arguments', local, server, browser, directory, watchdog, report, cancelled = false;
const close = async () => {
  const results = await Promise.allSettled([browser?.close(), server?.close(), local?.mf.dispose()]);
  assert.ok(results.every(result => result.status === 'fulfilled'));
};
const interrupted = () => { cancelled = true; process.exitCode = 1; void browser?.close().catch(() => {}); };
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-login -- [--channel chromium|chrome|msedge]\nLocal browser OIDC redirect, PKCE, signed API access and refresh checks; no external provider connection.');
  else {
    watchdog = setTimeout(interrupted, 60000);
    stage = 'setup'; await mkdir(resolve(root, '.tmp'), { recursive: true });
    directory = await mkdtemp(resolve(root, '.tmp/admin-login-'));
    local = await adminLoginFixture(directory);
    assert.equal(cancelled, false);
    const changesBefore = await local.db.prepare('SELECT * FROM admin_changes ORDER BY id').all();
    const previousCollector = process.env.TALLYFIN_COLLECTOR_ORIGIN;
    // The fixture must not inherit a real collector target or public login values from the caller.
    process.env.TALLYFIN_COLLECTOR_ORIGIN = new URL(await local.mf.ready).origin;
    try { server = await createServer({ root: resolve(root, 'apps/admin'), configFile: resolve(root, 'apps/admin/vite.config.mjs'),
      envDir: false, envPrefix: [],
      define: Object.fromEntries(Object.entries({ VITE_OIDC_ISSUER: local.issuer, VITE_OIDC_CLIENT_ID: local.clientId,
        VITE_OIDC_SCOPE: 'openid offline_access', VITE_OIDC_RESOURCE: local.resource, VITE_OIDC_ID_TOKEN_ALG: 'RS256',
        VITE_OIDC_PASSWORD_CHANGE_URL: local.issuer + '/account/password' }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
      server: { host: '127.0.0.1', port: 0, proxy: { '^/v1(?:/|\\?|$)': { target: new URL(await local.mf.ready).origin, changeOrigin: false } } }, logLevel: 'error' });
    } finally { if (previousCollector === undefined) delete process.env.TALLYFIN_COLLECTOR_ORIGIN; else process.env.TALLYFIN_COLLECTOR_ORIGIN = previousCollector; }
    assert.equal(cancelled, false);
    await server.listen();
    assert.equal(cancelled, false);
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
    browser = await chromium.launch({ channel: values.channel, headless: true });
    assert.equal(cancelled, false);
    let routeError = false, pageErrors = 0;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => { try { await local.route(route); } catch { routeError = true; await route.abort().catch(() => {}); } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', () => { pageErrors++; });
    const emptyStorage = async () => {
      assert.ok(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));
      assert.equal((await context.cookies()).length, 0);
    };
    stage = 'login'; await page.goto(origin);
    await page.locator('.login-workspace h1').waitFor();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    stage = 'password-menu';
    await page.locator('.events-advanced > summary').click();
    const passwordMenu = page.getByRole('link', { name: '비밀번호 변경 (새 탭)', exact: true });
    await passwordMenu.waitFor();
    assert.equal(await passwordMenu.getAttribute('href'), local.issuer + '/account/password');
    assert.equal(await passwordMenu.getAttribute('target'), '_blank');
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/auth/callback');
    assert.equal(new URL(page.url()).search, ''); await emptyStorage();
    assert.equal(local.counts.exchanges, 1); assert.equal(local.counts.refreshes, 0);
    stage = 'refresh';
    // Count concurrent callers without observing or retaining the returned bearer values.
    await page.evaluate(async () => {
      const { BrowserLogin } = await import('/src/auth/client.ts');
      const original = BrowserLogin.prototype.getAccessToken;
      let pending = 0, peak = 0;
      window.__loginConcurrency = () => peak;
      BrowserLogin.prototype.getAccessToken = async function () {
        pending++; peak = Math.max(peak, pending);
        try { return await original.call(this); } finally { pending--; }
      };
    });
    // Advance only the browser wall clock, avoiding a real five-minute wait.
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date); Date.now = () => realNow() + 271000;
      window.__restoreLoginClock = () => { Date.now = realNow; };
    });
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.locator('#settings-name').waitFor();
    await page.locator('#settings-tab-diagnostics').click();
    await page.getByText('저장소 읽기 확인', { exact: true }).click();
    await page.getByRole('button', { name: '읽기 확인', exact: true }).click();
    await page.getByText(/^저장소 읽기를 확인했어요\./).waitFor();
    assert.equal(local.counts.refreshes, 1);
    assert.ok(await page.evaluate(() => window.__loginConcurrency() > 1)); await emptyStorage();
    stage = 'refresh-failure'; local.setMode('refresh-error');
    await page.evaluate(() => { const previous = Date.now.bind(Date); Date.now = () => previous() + 271000; });
    await page.getByRole('button', { name: '개요', exact: true }).click();
    await page.getByRole('heading', { name: '인증이 필요해요', exact: true }).waitFor();
    assert.equal(local.counts.refreshes, 2); assert.ok(!(await page.locator('body').innerText()).includes('private-provider-detail'));
    await emptyStorage();
    stage = 'direct-login-recovery'; await page.evaluate(() => window.__restoreLoginClock());
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor(); await emptyStorage();
    stage = 'bad-state'; local.setMode('bad-state'); const before = local.counts.exchanges;
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '로그인을 완료하지 못했어요.' }).waitFor();
    assert.equal(local.counts.exchanges, before); assert.equal(new URL(page.url()).search, ''); await emptyStorage();
    stage = 'relogin'; local.setMode('normal');
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    assert.equal(local.counts.exchanges, before + 1); await emptyStorage();
    stage = 'identity-login-recovery';
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.locator('#settings-name').waitFor();
    await page.locator('#settings-name').fill('Unsaved recovery draft');
    let identityStatus = 403;
    await context.route('**/v1/identity', route => route.fulfill({ status: identityStatus,
      contentType: 'application/json', body: JSON.stringify({ error: { code: identityStatus === 401 ? 'unauthorized' : 'forbidden' } }) }));
    await page.locator('#settings-tab-access').click();
    await page.getByText('로그인 계정 확인', { exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'HTTP 403' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '관리자 로그인', exact: true }).count(), 0);
    identityStatus = 401;
    await page.getByRole('button', { name: '다시 확인', exact: true }).click();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('#settings-name').inputValue(), 'Unsaved recovery draft');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    assert.equal(await page.locator('#settings-name').inputValue(), 'Unsaved recovery draft');
    await emptyStorage();
    await context.unroute('**/v1/identity');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '관리자 로그인', exact: true }).count(), 0);
    await emptyStorage();
    stage = 'disconnect';
    await page.locator('.events-advanced > summary').click();
    await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    stage = 'reload'; await page.reload();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '연결 끊기', exact: true }).count(), 0);
    await emptyStorage();
    assert.equal(routeError, false); assert.equal(pageErrors, 0);
    assert.ok(JSON.stringify(changesBefore.results) === JSON.stringify((await local.db.prepare('SELECT * FROM admin_changes ORDER BY id').all()).results));
    assert.equal(cancelled, false);
    report = { verified: true, browser: browser.version(), pkceRedirect: true, signedApiAccess: true,
      callbackScrubbed: true, sharedRotatingRefresh: true, refreshFailureClears: true, invalidStateRejected: true,
      directLoginRecovery: true, identityLoginRecovery: true, forbiddenKeepsSession: true, recoveryDraftGuard: true,
      disconnectClears: true, relogin: true, reloadClears: true, storageEmpty: true, noAdminWrites: true, pageErrors, ...local.counts };
  }
} catch { console.error(JSON.stringify({ verified: false, stage })); process.exitCode = 1; }
finally {
  clearTimeout(watchdog);
  let cleanupFailed = false;
  try { await close(); } catch { cleanupFailed = true; }
  try {
    if (directory) { assert.ok(resolve(directory).startsWith(resolve(root, '.tmp') + sep)); await rm(directory, { recursive: true, force: true }); }
  } catch { cleanupFailed = true; }
  if (cleanupFailed) { console.error(JSON.stringify({ verified: false, stage: 'cleanup' })); process.exitCode = 1; }
  process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
}
if (report && process.exitCode !== 1) console.log(JSON.stringify(report));
