import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, directory, watchdog, stage = 'fixture', routeError = false, eventFailure = false;
const pageErrors = [], screenshots = [], apiLog = [];
try {
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-locales-'));
  local = await adminLoginFixture(directory, { profile: 'goals' });
  watchdog = setTimeout(() => { void browser?.close(); }, 90000);
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
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/v1/')) apiLog.push({ stage, path, method: route.request().method() });
    if (eventFailure && new URL(route.request().url()).pathname === '/v1/projects/sembom/events/tool_view/daily')
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_unavailable' } }) });
    try { await local.route(route); } catch { routeError = true; await route.abort().catch(() => {}); }
  });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  const language = () => page.getByRole('combobox', { name: /^(언어|Language)$/ });
  const switchLocale = async locale => {
    await language().selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(language()).toBeEnabled();
  };
  const nav = () => page.locator('.nav-list');
  const tab = name => page.getByRole('tab', { name, exact: true });
  const snapshot = async (name, width = 1440) => {
    await page.setViewportSize({ width, height: 1024 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow at ${width}px`);
    const path = resolve(directory, `${name}-${width}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push(path);
  };

  stage = 'login'; await page.goto(origin);
  await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  stage = 'event-selection'; await nav().getByRole('button', { name: '이벤트 분석', exact: true }).click();
  await page.locator('.event-explorer-item[aria-pressed=true]').waitFor();
  await page.getByRole('button', { name: 'tool_view', exact: true }).click();
  await expect(page.locator('.event-detail .recharts-wrapper')).toBeVisible();
  const selectedEvent = await page.locator('.event-explorer-item[aria-pressed=true]').getAttribute('aria-label');
  await page.waitForLoadState('networkidle');
  const reads = local.counts.apiReads, authorizations = local.counts.authorizations;
  const downloadCsv = async () => {
    const download = page.waitForEvent('download'); await page.locator('.csv-export button').click();
    return readFile(await (await download).path(), 'utf8');
  };
  const koreanCsv = await downloadCsv();
  stage = 'event-locale'; await switchLocale('en');
  await expect(page.getByRole('heading', { name: 'Daily event trend', exact: true })).toBeVisible();
  assert.equal(await page.locator('.event-explorer-item[aria-pressed=true]').getAttribute('aria-label'), selectedEvent);
  assert.equal(local.counts.apiReads, reads); assert.equal(local.counts.authorizations, authorizations);
  assert.equal(await downloadCsv(), koreanCsv, 'UI language must not change the CSV contract or data');
  await snapshot('events-en'); await snapshot('events-en', 390); await page.setViewportSize({ width: 1440, height: 1024 });
  stage = 'event-error'; eventFailure = true;
  await page.getByText('Connection settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Storage unavailable', exact: true })).toBeVisible();
  await switchLocale('ko');
  await expect(page.getByRole('heading', { name: '저장소를 사용할 수 없어요', exact: true })).toBeVisible();
  eventFailure = false; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.event-detail .recharts-wrapper')).toBeVisible();

  stage = 'goals-locale'; await nav().getByRole('button', { name: '목표', exact: true }).click();
  await expect(page.locator('.goal-inspector')).toBeVisible();
  const goal = await page.locator('.goal-option[aria-pressed=true]').getAttribute('aria-label');
  await switchLocale('en'); await expect(page.locator('.goal-explorer h2')).toContainText('Goal');
  assert.equal(await page.locator('.goal-option[aria-pressed=true]').getAttribute('aria-label'), goal);
  assert.ok(!(await page.locator('.goal-inspector').innerText()).includes('NaN'));
  await snapshot('goals-en'); await snapshot('goals-en', 390); await page.setViewportSize({ width: 1440, height: 1024 });
  for (const name of ['Failure reasons', 'Duration', 'Property analysis']) {
    await page.locator('.goal-tabs').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.goal-tabs').getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const detail = page.locator('.goal-panel');
    assert.ok(!/[가-힣]/u.test(await detail.innerText()), `${name}: untranslated authored detail copy`);
  }
  await page.locator('.goal-tabs').getByRole('button', { name: 'Overview', exact: true }).click();

  stage = 'settings-draft'; await nav().getByRole('button', { name: 'Settings', exact: true }).click();
  const name = page.locator('#settings-name'), schema = page.locator('#schema-draft');
  await expect(name).toBeEnabled(); const originalName = await name.inputValue();
  await name.fill('Unchanged 초안 ㅇㅅㅇ');
  // Hidden diagnostics finish with a dependent summary read after their first reads.
  await expect(page.locator('.collection-diagnostics')).not.toHaveAttribute('aria-busy', 'true');
  await page.waitForLoadState('networkidle');
  const readsBeforeSettingsLocale = local.counts.apiReads, writesBefore = local.counts.apiWrites, logStart = apiLog.length;
  await switchLocale('ko'); await expect(name).toHaveValue('Unchanged 초안 ㅇㅅㅇ');
  await switchLocale('en'); await expect(name).toHaveValue('Unchanged 초안 ㅇㅅㅇ');
  assert.equal(local.counts.apiReads, readsBeforeSettingsLocale, JSON.stringify(apiLog.slice(logStart))); assert.equal(local.counts.apiWrites, writesBefore);
  await snapshot('settings-project-en');
  // A validation result remains the same state while its text changes language.
  stage = 'settings-validation'; await name.fill('');
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const englishError = await page.locator('#settings-name-error').textContent();
  assert.ok(!/[가-힣]/u.test(englishError), englishError);
  await switchLocale('ko'); assert.match(await page.locator('#settings-name-error').textContent(), /[가-힣]/u);
  await expect(name).toHaveValue(''); await name.fill(originalName);
  stage = 'schema-draft'; await tab('이벤트 스키마').click(); await expect(schema).toBeEditable();
  const originalSchema = await schema.inputValue(); await schema.fill(originalSchema + '\n');
  await switchLocale('en'); await expect(schema).toHaveValue(originalSchema + '\n');
  await expect(page.locator('[role=tab][aria-selected=true]')).toContainText(/schema/i);
  await snapshot('settings-schema-en');
  await schema.fill('{'); await page.getByRole('button', { name: 'Validate definition', exact: true }).click();
  await expect(schema).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#schema-errors')).toContainText('Enter JSON');
  await switchLocale('ko'); await expect(schema).toHaveValue('{'); await schema.fill(originalSchema);
  for (const ko of ['수집 진단', 'SDK 연결', '접근 권한']) {
    await tab(ko).click(); await switchLocale('en');
    await expect(page.locator('[role=tabpanel]:visible')).toHaveCount(1);
    await snapshot(`settings-${ko === '수집 진단' ? 'diagnostics' : ko === 'SDK 연결' ? 'sdk' : 'access'}-en`);
    await switchLocale('ko');
  }
  stage = 'mobile-settings'; await switchLocale('en');
  for (const index of [0, 1, 2, 3, 4]) {
    await page.getByRole('tab').nth(index).click(); await snapshot(`settings-tab-${index}-en`, 390);
  }
  assert.deepEqual(pageErrors, []); assert.equal(routeError, false);
  assert.equal(local.counts.authorizations, 1); assert.equal(local.counts.apiWrites, 0);
  const report = { verified: true, stage, statePreservingLocaleSwitch: true, helperErrorsRetranslated: true,
    selectedEventRetained: true, selectedGoalRetained: true, schemaDraftRetained: true,
    noLocaleTriggeredApiReads: true, noApiWrites: true, csvUnchanged: true, screenshots, pageErrors, routeError, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verified: true, evidence: directory, ...local.counts }));
} catch (error) {
  if (directory) { await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, message: error.message, pageErrors, routeError, apiLog }));
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {}); }
  console.error(JSON.stringify({ verified: false, stage, message: error.message })); process.exitCode = 1;
} finally { clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
