import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let local, server, browser, page, directory, watchdog;
let stage = 'fixture', routeError = false;
const pageErrors = [];
try {
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-settings-workspace-'));
  local = await adminLoginFixture(directory, { profile: 'access' });
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
  await context.route('**/*', async route => { try { await local.route(route); } catch { routeError = true; await route.abort().catch(() => {}); } });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message));
  stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  const nav = page.getByRole('navigation', { name: '주요 탐색', exact: true });
  await nav.getByRole('button', { name: '설정', exact: true }).click();
  const tab = name => page.getByRole('tab', { name, exact: true });
  const name = page.locator('#settings-name'), draft = page.locator('#schema-draft');
  stage = 'initial-project'; await expect(name).toBeEnabled();
  assert.equal(await page.getByRole('tab').count(), 5);
  assert.equal(await page.getByRole('combobox', { name: '조회 기간', exact: true }).count(), 0);
  await page.screenshot({ path: resolve(directory, 'project-desktop.png') });
  const initial = await name.inputValue(); await name.fill('Retained tab draft');
  stage = 'keyboard-tabs'; await tab('프로젝트').click();
  await tab('프로젝트').press('ArrowRight'); await expect(tab('수집 진단')).toBeFocused();
  await tab('수집 진단').press('End'); await expect(tab('접근 권한')).toBeFocused();
  await expect(page.getByRole('heading', { name: '프로젝트 권한', exact: true })).toBeVisible();
  await expect(name).toBeHidden();
  await tab('접근 권한').press('Home'); await expect(tab('프로젝트')).toBeFocused();
  await expect(name).toHaveValue('Retained tab draft'); await name.fill(initial);
  stage = 'schema'; await tab('이벤트 스키마').click(); await expect(draft).toBeEditable();
  await expect(page.getByRole('button', { name: /^새 버전 발행/ })).toBeDisabled();
  const originalDraft = await draft.inputValue(); await draft.fill(originalDraft + '\n');
  await tab('SDK 연결').click(); await expect(draft).toBeHidden();
  await expect(page.getByRole('heading', { name: 'SDK 연결 안내', exact: true })).toBeVisible();
  await tab('이벤트 스키마').click(); await expect(draft).toHaveValue(originalDraft + '\n');
  await page.getByRole('button', { name: '정의 검증', exact: true }).click();
  const privacy = page.getByRole('checkbox', { name: '정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.', exact: true });
  await expect(privacy).toBeEnabled(); await privacy.check();
  await expect(page.getByRole('button', { name: /^새 버전 발행/ })).toBeEnabled();
  await draft.press('Control+Home'); await tab('이벤트 스키마').click();
  await page.screenshot({ path: resolve(directory, 'schema-desktop.png') });
  stage = 'invalid-json'; await draft.fill('{');
  await expect(page.getByRole('button', { name: /^새 버전 발행/ })).toBeDisabled();
  await page.getByRole('button', { name: '정의 검증', exact: true }).click();
  await expect(draft).toHaveAttribute('aria-invalid', 'true'); await expect(draft).toBeFocused();
  await draft.fill(originalDraft);
  stage = 'form-errors'; await page.getByRole('button', { name: '폼으로 편집', exact: true }).click();
  await expect(page.locator('#schema-event-0-label')).toBeVisible();
  await page.getByRole('button', { name: 'JSON 직접 편집', exact: true }).click();
  stage = 'responsive';
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1024 });
    for (const label of ['프로젝트', '수집 진단', '이벤트 스키마', 'SDK 연결', '접근 권한']) {
      await tab(label).click();
      await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: horizontal overflow at ${width}px`);
    }
    await tab('프로젝트').click();
    if (width === 390) await page.screenshot({ path: resolve(directory, 'project-mobile.png') });
  }
  stage = 'save'; await name.fill('Saved settings workspace');
  await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  await expect(page.getByText('프로젝트 설정을 저장했어요.', { exact: true })).toBeVisible();
  assert.equal(await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first('name'), 'Saved settings workspace');
  assert.equal(local.counts.apiWrites, 2); // Valid definition validation and settings PATCH; malformed JSON is rejected locally.
  assert.deepEqual(pageErrors, []); assert.equal(routeError, false);
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ verified: true, keyboardTabs: true, draftRetention: true,
    validationGate: true, invalidJsonFocus: true, localD1Save: true, responsive: [390, 768, 1280], pageErrors, routeError, ...local.counts }, null, 2));
  console.log(JSON.stringify({ verified: true, evidence: directory, ...local.counts }));
} catch (error) {
  if (directory) { await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, message: error.message, pageErrors, routeError }));
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {}); }
  console.error(JSON.stringify({ verified: false, stage, message: error.message })); process.exitCode = 1;
} finally { clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
