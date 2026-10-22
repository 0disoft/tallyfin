import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { Provisioner } from '../provision/store.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const subject = 'synthetic-login-operator';
let local, server, browser, page, directory, watchdog, stage = 'fixture', pageErrors = 0, routeError = false, fault = null;
const searches = [], scenarios = [];
try {
  watchdog = setTimeout(() => { void browser?.close(); }, 60000);
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-project-search-'));
  local = await adminLoginFixture(directory);
  const provisioner = new Provisioner(local.db);
  const registry = JSON.parse(await readFile(resolve(root, 'api/examples/registry.json'), 'utf8'));
  for (let i = 0; i < 30; ++i) {
    const value = structuredClone(registry); value.project.id = `service-${String(i).padStart(2, '0')}`; value.project.name = `계산 Tool ${i}`;
    await provisioner.apply(await provisioner.plan('register', value));
    await provisioner.apply(await provisioner.plan('grant', { projectId: value.project.id, issuer: local.issuer, subject, role: 'owner' }));
  }
  const privateProject = structuredClone(registry); privateProject.project.id = 'private-service'; privateProject.project.name = '계산 Tool private';
  await provisioner.apply(await provisioner.plan('register', privateProject));
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
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    try {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === '/v1/projects' && url.searchParams.has('q')) {
        searches.push({ q: url.searchParams.get('q'), cursor: url.searchParams.get('cursor') });
        if (fault === 'unavailable') { fault = null; return await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_unavailable' } }) }); }
      }
      await local.route(route);
    } catch { routeError = true; await route.abort().catch(() => {}); }
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', () => pageErrors++);
  stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  const picker = page.getByRole('combobox', { name: '프로젝트 선택', exact: true });
  const search = page.getByRole('searchbox', { name: '프로젝트 검색', exact: true });
  await expect(picker.locator('option')).toHaveCount(25);
  assert.ok(!await picker.locator('option[value="service-29"]').count());
  const original = await picker.inputValue();

  stage = 'unloaded-project-and-selection'; await search.fill('SERVICE-29');
  await expect(page.locator('#project-search-status')).toContainText('검색 결과 1개');
  await expect(picker).toHaveValue(original); await picker.selectOption('service-29'); await expect(picker).toHaveValue('service-29');
  await search.fill('missing'); await expect(page.locator('#project-search-status')).toContainText('검색 결과 0개');
  await expect(picker).toHaveValue('service-29'); await search.fill(''); await expect(picker).toHaveValue('service-29'); scenarios.push(stage);

  stage = 'off-page-refresh'; await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(picker).toBeEnabled(); await expect(picker).toHaveValue('service-29'); scenarios.push(stage);

  stage = 'filtered-pagination-and-grants'; await search.fill('계산 tool');
  await expect(page.locator('#project-search-status')).toContainText('검색 결과 25개');
  await page.getByRole('button', { name: '검색 결과 더 불러오기', exact: true }).click();
  await expect(page.locator('#project-search-status')).toContainText('검색 결과 30개');
  await expect(picker.locator('option[value="private-service"]')).toHaveCount(0);
  assert.ok(searches.some(item => item.q === '계산 tool' && item.cursor)); scenarios.push(stage);

  stage = 'failure-and-retry'; fault = 'unavailable'; await search.fill('service-28');
  await page.getByRole('button', { name: '검색 다시 시도', exact: true }).click();
  await expect(page.locator('#project-search-status')).toContainText('검색 결과 1개'); await expect(picker).toHaveValue('service-29'); scenarios.push(stage);

  stage = 'draft-and-fast-query-changes'; await search.fill('');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const name = page.getByRole('textbox', { name: '프로젝트 이름', exact: true }); await expect(name).toBeEnabled(); await name.fill('아직 저장하지 않은 이름');
  await search.fill('계산'); await search.fill('service-27');
  await expect(page.locator('#project-search-status')).toContainText('검색 결과 1개');
  await expect(name).toHaveValue('아직 저장하지 않은 이름'); await expect(picker).toHaveValue('service-29');
  let dialogs = 0; page.once('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  await picker.selectOption('service-27'); await expect(picker).toHaveValue('service-29'); assert.equal(dialogs, 1);
  await expect(name).toHaveValue('아직 저장하지 않은 이름'); scenarios.push(stage);
  await search.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(directory, 'search-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await search.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(directory, 'search-mobile.png') });

  stage = 'disconnect'; page.once('dialog', async dialog => dialog.accept());
  await page.getByRole('button', { name: '연결 끊기', exact: true }).click(); await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
  assert.equal(routeError, false); assert.equal(pageErrors, 0); assert.equal(local.counts.apiWrites, 0);
  const report = { verified: true, browser: browser.version(), scenarios, searches, pageErrors, routeError, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ...report, directory }));
} catch (error) {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, verified: false, error: error.message }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, error: error.message }));
} finally { clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
