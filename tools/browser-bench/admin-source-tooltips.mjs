import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { ACTIVE_LOCALES } from '../../apps/admin/src/i18n/preference.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, directory, watchdog, stage = 'fixture';
const errors = [], cases = [];
try {
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-source-tooltips-'));
  local = await adminLoginFixture(directory, { profile: 'goals' });
  server = await createServer({ root: resolve(root, 'apps/admin'), configFile: resolve(root, 'apps/admin/vite.config.mjs'),
    envDir: false, envPrefix: [], cacheDir: resolve(directory, 'vite-cache'), logLevel: 'error',
    define: Object.fromEntries(Object.entries({ VITE_OIDC_ISSUER: local.issuer, VITE_OIDC_CLIENT_ID: local.clientId,
      VITE_OIDC_SCOPE: 'openid offline_access', VITE_OIDC_RESOURCE: local.resource, VITE_OIDC_ID_TOKEN_ALG: 'RS256' })
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    server: { host: '127.0.0.1', port: 0, proxy: { '^/v1(?:/|\\?|$)': { target: new URL(await local.mf.ready).origin, changeOrigin: false } } },
  });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
  browser = await chromium.launch({ headless: true });
  watchdog = setTimeout(() => { void browser?.close(); }, 120000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => { await local.route(route); });
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await page.locator('.nav-list button').nth(1).click(); await expect(page.locator('.event-source-switch')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  const buttons = page.locator('.event-source-switch button'), tips = page.getByRole('tooltip');
  stage = 'hover-boundary'; await buttons.nth(0).hover(); await page.clock.runFor(1999); await expect(tips).toHaveCount(0);
  await page.clock.runFor(1); await expect(tips).toHaveCount(1); await expect(tips).toContainText('웹 브라우저');
  const before = await buttons.nth(0).boundingBox(); await tips.hover(); await page.clock.runFor(1000);
  await expect(tips).toHaveCount(1); assert.deepEqual(await buttons.nth(0).boundingBox(), before);
  await page.keyboard.press('Escape'); await expect(tips).toHaveCount(0); cases.push(stage);
  stage = 'early-leave'; await buttons.nth(1).hover(); await page.clock.runFor(1000);
  await page.locator('.page-header h1').hover(); await page.clock.runFor(2000); await expect(tips).toHaveCount(0); cases.push(stage);
  stage = 'keyboard'; await page.locator('.event-explorer input[type=search]').focus(); await page.keyboard.press('Tab');
  await expect(buttons.nth(0)).toBeFocused(); await expect(tips).toHaveCount(1);
  await expect(buttons.nth(0)).toHaveAttribute('aria-describedby', await tips.getAttribute('id'));
  await page.keyboard.press('Escape'); await expect(tips).toHaveCount(0); await expect(buttons.nth(0)).toBeFocused();
  await page.keyboard.press('Tab'); await expect(buttons.nth(1)).toBeFocused(); await expect(tips).toContainText('서버');
  await page.keyboard.press('Tab'); await expect(tips).toHaveCount(0); cases.push(stage);
  stage = 'selection'; await buttons.nth(1).hover(); await page.clock.runFor(2000); await expect(tips).toHaveCount(1);
  await buttons.nth(1).click(); await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true'); await expect(tips).toHaveCount(0);
  await buttons.nth(0).click(); await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true'); cases.push(stage);
  await page.waitForLoadState('networkidle');
  // Locale changes must translate both explanations without changing the selected source.
  for (const locale of ACTIVE_LOCALES) {
    const labels = JSON.parse(await readFile(resolve(root, `apps/admin/locales/${locale}/analysis.json`), 'utf8'));
    await page.locator('.locale-control select').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.waitForLoadState('networkidle');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (let index = 0; index < 2; index++) {
        stage = `${locale}/${width}/${index}`;
        await page.locator('.page-header h1').hover(); await page.clock.runFor(200);
        await buttons.nth(index).hover(); await page.clock.runFor(2000);
        await expect(tips).toHaveText(index === 0 ? labels.sourceBrowserHelp : labels.sourceServerHelp);
        const rect = await tips.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= 1000, stage);
        await page.keyboard.press('Escape'); await expect(tips).toHaveCount(0); cases.push(stage);
      }
      await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    }
  }
  await page.locator('.locale-control select').selectOption('ko'); await page.setViewportSize({ width: 1440, height: 1000 });
  await buttons.nth(0).hover(); await page.clock.runFor(2000); await expect(tips).toHaveCount(1);
  await page.clock.runFor(150); await page.screenshot({ path: resolve(directory, 'browser-tooltip.png'), fullPage: true });
  await page.keyboard.press('Escape');
  stage = 'comparison'; await page.getByRole('checkbox', { name: '직전 기간과 비교', exact: true }).check();
  await expect(page.locator('.event-workspace')).toHaveClass(/is-comparing/);
  await page.locator('.page-header h1').hover(); await buttons.nth(1).hover();
  await page.clock.runFor(2000); await expect(tips).toContainText('서버'); cases.push(stage);
  stage = 'unmount-cleanup'; await page.locator('.nav-list button').nth(3).click(); await expect(tips).toHaveCount(0);
  await page.clock.runFor(3000); await expect(tips).toHaveCount(0); cases.push(stage);
  assert.equal(local.counts.apiWrites, 0); assert.deepEqual(errors, []);
  const report = { verified: true, cases, errors, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verified: true, cases: cases.length, directory, ...local.counts }));
} catch (error) {
  await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ verified: false, stage, message: error.message, directory })); process.exitCode = 1;
} finally { clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
