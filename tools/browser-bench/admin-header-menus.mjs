import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, directory, watchdog, stage = 'fixture', routeError = false;
const errors = [], cases = [];
try {
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-header-menus-'));
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
  await context.route('**/*', async route => { try { await local.route(route); } catch { routeError = true; await route.abort().catch(() => {}); } });
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await expect(page.locator('.overview-workspace')).toBeVisible();
  const connection = page.locator('details.events-advanced'), trigger = connection.locator(':scope > summary');
  const search = page.locator('details.events-project-search'), searchTrigger = search.locator(':scope > summary');
  const version = connection.locator('input[inputmode=numeric]'), query = search.locator('input[type=search]');
  const language = page.locator('.locale-control select');
  for (let view = 0; view < 4; view++) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('.nav-list button').nth(view).click();
    for (const width of [1440, 1280, 390]) {
      stage = `${view}/${width}`; await page.setViewportSize({ width, height: 1000 });
      const before = await trigger.boundingBox(), header = await page.locator('.page-header').boundingBox();
      await trigger.click(); await expect(connection).toHaveAttribute('open', '');
      const after = await trigger.boundingBox(), expanded = await page.locator('.page-header').boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[key] - after[key]) < 1, `${stage}: trigger moved (${key})`);
      assert.equal(header.height, expanded.height, `${stage}: header grew`);
      const panel = await page.locator('.events-advanced-panel').boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1, `${stage}: offscreen panel`);
      await version.click(); await expect(connection).toHaveAttribute('open', '');
      const savedVersion = await version.inputValue();
      await version.dispatchEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true });
      await expect(connection).toHaveAttribute('open', '');
      if (view === 1 && width !== 1280) await page.screenshot({ path: resolve(directory, `connection-${width}.png`), fullPage: true });
      await version.press('Escape'); await expect(connection).not.toHaveAttribute('open', ''); await expect(trigger).toBeFocused();
      await expect(version).toHaveValue(savedVersion);
      await trigger.press('Enter'); await expect(connection).toHaveAttribute('open', '');
      await page.locator('.page-header h1').click(); await expect(connection).not.toHaveAttribute('open', '');
      await trigger.click(); await searchTrigger.click();
      await expect(connection).not.toHaveAttribute('open', ''); await expect(search).toHaveAttribute('open', '');
      await expect(page.locator('details[data-header-menu][open]')).toHaveCount(1);
      await query.fill('sem'); await query.press('Escape'); await expect(searchTrigger).toBeFocused();
      await expect(search).not.toHaveAttribute('open', '');
      await searchTrigger.press('Enter'); await expect(query).toHaveValue('sem');
      await language.focus(); await expect(search).not.toHaveAttribute('open', ''); await expect(language).toBeFocused();
      await trigger.click(); await version.focus();
      for (let tab = 0; tab < 16 && await connection.getAttribute('open') !== null; tab++) await page.keyboard.press('Tab');
      await expect(connection).not.toHaveAttribute('open', '');
      assert.equal(await connection.evaluate(menu => menu.contains(menu.ownerDocument.activeElement)), false, `${stage}: focus returned on outside Tab`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${stage}: overflow`);
      cases.push(stage);
    }
  }
  stage = 'unmount-cleanup'; await trigger.click();
  await connection.getByRole('button', { name: '연결 끊기', exact: true }).click();
  await expect(page.getByRole('button', { name: '관리자 로그인', exact: true })).toBeVisible();
  await language.focus();
  assert.equal(await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))), true);
  await expect(language).toBeFocused();
  stage = 'reconnect'; await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await trigger.click(); await trigger.press('Escape'); await expect(connection).not.toHaveAttribute('open', ''); await expect(trigger).toBeFocused();
  assert.equal(local.counts.apiWrites, 0); assert.equal(local.counts.authorizations, 2);
  assert.deepEqual(errors, []); assert.equal(routeError, false);
  const report = { verified: true, cases, stage, stableTrigger: true, escapeReturnsFocus: true, outsideDismissal: true,
    inputRetained: true, exclusiveMenus: true, compositionPreserved: true, cleanupVerified: true, errors, routeError, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, directory }));
} catch (error) {
  if (directory) { await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, message: error.message, errors, routeError }, null, 2));
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {}); }
  console.error(JSON.stringify({ verified: false, stage, message: error.message, directory })); process.exitCode = 1;
} finally { clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
