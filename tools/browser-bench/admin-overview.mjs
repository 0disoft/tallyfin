import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { todayInZone, shiftDate } from '../../apps/admin/src/api/dates.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, directory, timer, stage = 'fixture';
let overviewReads = 0, routeError = false, failWorkflow = false;
const pageErrors = [];
const englishFile = resolve(root, 'apps/admin/locales/en/admin.json');
let originalEnglish;
try {
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-overview-'));
  local = await adminLoginFixture(directory, { profile: 'goals' });
  const today = todayInZone('Asia/Seoul'), names = ['tool_view', 'input_start', 'calculation_success', 'validation_error', 'result_copy', 'feedback_submit'];
  const counts = [10000, 5000, 4320, 180, 3000, 2360];
  for (let i = 0; i < 7; i++) {
    const day = shiftDate(today, i - 6), portion = total => Math.floor(total * (i + 1) / 7) - Math.floor(total * i / 7);
    await local.db.batch(names.map((name, n) => local.db.prepare('INSERT INTO event_daily_counts (project_id,schema_version,source,event_date,event_name,dimension_key,count,updated_at) VALUES (?,1,?,?,?,?,?,?)')
      .bind('sembom', 'browser', day, name, '{}', portion(counts[n]), Date.now())));
    await local.db.prepare('INSERT INTO workflow_daily_counts (project_id,schema_version,source,cohort_date,workflow_id,dimension_key,started_count,succeeded_count,failed_count,updated_at) VALUES (?,1,?,?,?,?,?,?,0,?)')
      .bind('sembom', 'browser', day, 'calculation', '{}', portion(5000), portion(4320), Date.now()).run();
  }
  timer = setTimeout(() => { void browser?.close(); }, 90000);
  server = await createServer({ root: resolve(root, 'apps/admin'), configFile: resolve(root, 'apps/admin/vite.config.mjs'),
    envDir: false, envPrefix: [], cacheDir: resolve(directory, 'vite-cache'), logLevel: 'error',
    define: Object.fromEntries(Object.entries({ VITE_OIDC_ISSUER: local.issuer, VITE_OIDC_CLIENT_ID: local.clientId,
      VITE_OIDC_SCOPE: 'openid offline_access', VITE_OIDC_RESOURCE: local.resource, VITE_OIDC_ID_TOKEN_ALG: 'RS256' })
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    server: { host: '127.0.0.1', port: 0, proxy: { '^/v1(?:/|\\?|$)': { target: new URL(await local.mf.ready).origin, changeOrigin: false } } },
  });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).pathname === '/v1/overview') overviewReads++;
    if (failWorkflow && new URL(route.request().url()).pathname === '/v1/projects/sembom/workflows/calculation/daily')
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_unavailable' } }) });
    try { await local.route(route); } catch { routeError = true; await route.abort().catch(() => {}); }
  });
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => pageErrors.push(error.message));
  stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  stage = 'counts'; await expect(page.locator('.metric-grid')).toContainText('24,860');
  await expect(page.locator('.metric-grid')).toContainText('86.4%');
  await expect(page.locator('.overview-outcomes')).toContainText('미정의');
  await expect(page.locator('.overview-outcomes')).toContainText('680');
  await expect.poll(() => page.locator('.overview-trend .recharts-surface').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(200);
  await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(7); assert.equal(overviewReads, 0);
  await page.screenshot({ path: resolve(directory, 'overview-desktop.png'), fullPage: true });
  stage = 'disclosure'; await page.getByRole('button', { name: '통합 현황 불러오기', exact: true }).click();
  await expect(page.locator('.overview-services tbody tr')).toHaveCount(2);
  assert.equal(await page.locator('.overview-services thead th').evaluateAll(cells => cells.every(cell => cell.getBoundingClientRect().width > 70)), true);
  assert.equal(overviewReads, 1);
  await page.locator('.overview-services').screenshot({ path: resolve(directory, 'services-detail.png') });
  await page.screenshot({ path: resolve(directory, 'services-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '통합 현황 닫기', exact: true }).click();
  stage = 'source'; await page.getByRole('button', { name: '서버 이벤트', exact: true }).click();
  await expect(page.getByRole('heading', { name: '서버 이벤트 분석', exact: true })).toBeVisible();
  await expect(page.locator('.metric')).toHaveCount(1); await expect(page.locator('.overview-outcomes')).toHaveCount(0);
  await page.getByRole('button', { name: '브라우저 이벤트', exact: true }).click();
  await expect(page.locator('.metric-grid')).toContainText('24,860');
  stage = 'comparison'; await page.getByRole('checkbox', { name: '직전 기간과 비교', exact: true }).check();
  await expect(page.locator('.period-comparison')).toBeVisible();
  await expect(page.locator('.metric-grid')).toContainText('이전 0건');
  await expect(page.locator('.metric-grid')).not.toContainText('Infinity');
  await page.getByRole('checkbox', { name: '직전 기간과 비교', exact: true }).uncheck();
  stage = 'workflow-failure'; failWorkflow = true;
  await page.getByText('연결 설정', { exact: true }).click();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('heading', { name: '저장소를 사용할 수 없어요', exact: true })).toBeVisible();
  await expect(page.locator('.metric-grid')).toHaveCount(0);
  await expect(page.locator('.overview-outcomes')).toHaveCount(0);
  await page.getByText('연결 설정', { exact: true }).click();
  failWorkflow = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.metric-grid')).toContainText('86.4%');
  stage = 'no-representative';
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other');
  await expect(page.getByRole('heading', { name: '대표 흐름 미지정', exact: true })).toBeVisible();
  await expect(page.locator('.overview-outcomes')).toHaveCount(0);
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await expect(page.locator('.metric-grid')).toContainText('86.4%');
  stage = 'ui-locale';
  const readsBeforeLocale = local.counts.apiReads;
  const authorizationsBeforeLocale = local.counts.authorizations;
  await page.locator('.locale-control select').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Tallyfin · Admin');
  await expect(page.locator('.metric-grid')).toContainText('Browser events collected');
  await expect(page.locator('.metric-grid')).toContainText('86.4%');
  await expect(page.locator('.overview-outcomes')).toContainText('Undefined');
  await expect(page.getByRole('combobox', { name: 'Select project', exact: true })).toHaveValue('sembom');
  assert.equal(local.counts.apiReads, readsBeforeLocale);
  assert.equal(local.counts.authorizations, authorizationsBeforeLocale);
  await page.screenshot({ path: resolve(directory, 'overview-en-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1024 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(directory, 'overview-en-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  const nameInput = page.locator('#settings-name');
  const savedName = await nameInput.inputValue();
  await nameInput.fill('Saylo draft retained');
  await page.locator('.locale-control select').selectOption('ko');
  await expect(nameInput).toHaveValue('Saylo draft retained');
  await page.locator('.locale-control select').selectOption('en');
  stage = 'catalog-live-update';
  originalEnglish = await readFile(englishFile, 'utf8');
  const edited = JSON.parse(originalEnglish); edited.navSettings = 'Settings live copy';
  await writeFile(englishFile, JSON.stringify(edited, null, 2) + '\n');
  await expect(page.getByRole('heading', { name: 'Settings live copy', exact: true })).toBeVisible();
  await expect(nameInput).toHaveValue('Saylo draft retained');
  await expect(page.getByRole('combobox', { name: 'Select project', exact: true })).toHaveValue('sembom');
  assert.equal(local.counts.authorizations, authorizationsBeforeLocale);
  await writeFile(englishFile, originalEnglish); originalEnglish = undefined;
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await nameInput.fill(savedName);
  await page.locator('.locale-control select').selectOption('ko');
  await page.getByRole('navigation', { name: '주요 탐색', exact: true }).getByRole('button', { name: '개요', exact: true }).click();
  await expect(page.locator('.metric-grid')).toContainText('86.4%');
  stage = 'responsive';
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(page.locator('.overview-event-row').first()).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(directory, `overview-${width}.png`), fullPage: true });
  }
  stage = 'navigation'; await page.getByRole('button', { name: '이벤트 분석 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '이벤트 탐색기', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: '주요 탐색', exact: true }).getByRole('button', { name: '개요', exact: true }).click();
  await page.getByRole('button', { name: '목표에서 자세히 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '목표 탐색기', exact: true })).toBeVisible();
  stage = 'locale-persistence';
  await page.locator('.locale-control select').selectOption('en');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('.locale-control select')).toHaveValue('en');
  assert.equal(routeError, false); assert.deepEqual(pageErrors, []); assert.equal(local.counts.apiWrites, 0);
  const report = { verified: true, stage, localeRetainsSessionAndProject: true, liveCopyRetainsDraft: true,
    localePreferenceSurvivesReload: true, overviewReads, pageErrors, routeError, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, directory }));
} catch (error) {
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, message: error.message, directory }));
  if (directory) { await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, message: error.message })); await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {}); }
} finally {
  if (originalEnglish !== undefined) await writeFile(englishFile, originalEnglish);
  clearTimeout(timer); await browser?.close(); await server?.close(); await local?.mf.dispose();
}
