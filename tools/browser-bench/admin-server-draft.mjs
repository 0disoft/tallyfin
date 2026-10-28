import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { D1Queries } from '@tallyfin/storage-d1';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const waitForHeld = async promise => {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('held_response_timeout')), 15000); })]); }
  finally { clearTimeout(timer); }
};
let local, server, browser, page, directory, watchdog, fault, held, stage = 'fixture';
let pageErrors = 0, routeError = false, writes = 0, reads = 0, unloadDialogs = 0;
const scenarios = [];
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-server-draft -- [--channel chromium|chrome|msedge]\nSigned local OIDC/D1: reload, CAS conflicts, lost/late write responses and owner access. No remote services.');
  else {
    watchdog = setTimeout(() => { held?.release.resolve(); void browser?.close(); }, 120000);
    await mkdir(resolve(root, '.tmp'), { recursive: true }); directory = await mkdtemp(resolve(root, '.tmp/admin-server-draft-'));
    local = await adminLoginFixture(directory, { profile: 'access' });
    const collector = new URL(await local.mf.ready).origin, previous = process.env.TALLYFIN_COLLECTOR_ORIGIN;
    delete process.env.TALLYFIN_COLLECTOR_ORIGIN;
    try {
      server = await createServer({ root: resolve(root, 'apps/admin'), configFile: resolve(root, 'apps/admin/vite.config.mjs'), envDir: false, envPrefix: [],
        cacheDir: resolve(directory, 'vite-cache'), logLevel: 'error',
        define: Object.fromEntries(Object.entries({ VITE_OIDC_ISSUER: local.issuer, VITE_OIDC_CLIENT_ID: local.clientId,
          VITE_OIDC_SCOPE: 'openid offline_access', VITE_OIDC_RESOURCE: local.resource, VITE_OIDC_ID_TOKEN_ALG: 'RS256' })
          .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
        server: { host: '127.0.0.1', port: 0, proxy: { '^/v1(?:/|\\?|$)': { target: collector, changeOrigin: false } } },
      });
    } finally { if (previous === undefined) delete process.env.TALLYFIN_COLLECTOR_ORIGIN; else process.env.TALLYFIN_COLLECTOR_ORIGIN = previous; }
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
    browser = await chromium.launch({ channel: values.channel, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), draft = url.origin === origin && url.pathname === '/v1/projects/sembom/schemas/draft';
      const writing = draft && route.request().method() === 'PUT', active = writing ? fault : null;
      if (draft) { if (writing) writes++; else reads++; } if (writing) fault = null;
      try {
        if (active === 'lost') return await local.route(route, { dropResponse: true });
        if (active === 'held') {
          const current = held;
          try { return await local.route(route, { afterCommit: async () => { current.received.resolve(); await current.release.promise; } }); }
          finally { current.finished.resolve(); }
        }
        await local.route(route);
      } catch { if (active !== 'held') routeError = true; await route.abort().catch(() => {}); }
    });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', () => pageErrors++);
    page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') { unloadDialogs++; await dialog.accept(); } });
    const workspace = async () => {
      await page.getByRole('button', { name: '관리자 로그인', exact: true }).click({ timeout: 30000 });
      await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
      await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
      await page.getByRole('button', { name: '설정', exact: true }).click();
      await page.getByText('연결 설정', { exact: true }).click();
      await page.getByRole('tab', { name: '이벤트 스키마', exact: true }).click();
      await page.getByText('초안 파일·서버 저장', { exact: true }).click();
      await expect(page.locator('#schema-version')).toBeEnabled();
      await page.getByText('JSON 직접 편집', { exact: true }).click();
    };
    stage = 'login'; await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 }); await workspace();
    const panel = page.getByRole('region', { name: '서버 초안', exact: true }), draft = page.locator('#schema-draft'), target = page.locator('#schema-version');
    const check = () => panel.getByRole('button', { name: /^(서버 초안 확인|서버 저장 결과 확인)$/ });
    const save = panel.getByRole('button', { name: '현재 입력을 서버에 저장', exact: true });
    const load = panel.getByRole('button', { name: '서버 초안 불러오기', exact: true });
    const confirmed = () => panel.getByText('현재 입력의 서버 저장을 확인했어요.', { exact: true });
    stage = 'explicit-create'; assert.equal(reads, 0); assert.equal(writes, 0); await expect(save).toBeDisabled();
    const original = await draft.inputValue(); await check().click(); await expect(panel).toContainText('저장된 서버 초안이 없어요.');
    await draft.fill('{unfinished 한글'); await target.fill(''); await save.click(); await expect(confirmed()).toBeVisible();
    assert.equal(writes, 1); scenarios.push(stage);
    stage = 'reload-and-explicit-restore'; await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); await workspace(); assert.equal(unloadDialogs, 0);
    await check().click(); await expect(load).toBeEnabled(); await expect(draft).toHaveValue(original);
    await load.click(); await expect(draft).toHaveValue('{unfinished 한글'); await expect(target).toHaveValue('');
    await expect(page.getByText('서버 초안을 불러왔어요. 버전과 정의를 검증하고 개인정보 검토를 다시 확인해 주세요.', { exact: true })).toBeVisible();
    scenarios.push(stage);
    stage = 'conflict-preserves-reviewed-input'; await draft.fill(original); await target.fill('3');
    await page.getByRole('button', { name: '정의 검증', exact: true }).click();
    const privacy = page.getByRole('checkbox', { name: '정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.', exact: true });
    await expect(privacy).toBeEnabled(); await privacy.check(); await check().click(); await expect(save).toBeEnabled();
    const other = new D1Queries(local.db), principal = { issuer: local.issuer, subject: 'synthetic-backup-operator' };
    const base = await other.schemaDraft(principal, 'sembom');
    await other.saveSchemaDraft(principal, 'sembom', { expectedRevision: base.draft.revision, targetVersion: '4', draftText: 'other owner draft' }, Date.now());
    await save.click(); await expect(panel.getByRole('alert')).toContainText('HTTP 409');
    await expect(draft).toHaveValue(original); await expect(target).toHaveValue('3'); await expect(privacy).toBeChecked();
    await expect(save).toBeDisabled(); await check().click();
    await panel.getByText('서버 초안과 현재 입력 보기', { exact: true }).click();
    await expect(panel.locator('pre[aria-label="저장된 서버 초안"]')).toHaveText('other owner draft');
    const beforeReview = writes;
    await panel.getByRole('button', { name: '현재 입력 유지하고 다시 저장 검토', exact: true }).click(); assert.equal(writes, beforeReview);
    await save.click(); await expect(confirmed()).toBeVisible(); await expect(privacy).toBeChecked(); scenarios.push(stage);
    stage = 'committed-lost-response'; await target.fill('5'); fault = 'lost'; const beforeLost = writes;
    await save.click(); await expect(panel.getByRole('alert')).toBeVisible(); await expect(save).toBeDisabled();
    assert.equal(writes, beforeLost + 1); await check().click(); await expect(confirmed()).toBeVisible(); assert.equal(writes, beforeLost + 1); scenarios.push(stage);
    stage = 'late-save-preserves-newer-input'; await target.fill('6');
    held = { received: deferred(), release: deferred(), finished: deferred() }; fault = 'held';
    await save.click(); await waitForHeld(held.received.promise); await draft.fill(original + '\n'); await target.fill('7');
    held.release.resolve(); await waitForHeld(held.finished.promise);
    await expect(panel).toContainText('이후 편집한 내용은 아직 저장하지 않았어요.');
    await expect(draft).toHaveValue(original + '\n'); await expect(target).toHaveValue('7');
    const cancelLoad = page.waitForEvent('dialog').then(async dialog => { assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
    await load.click(); await cancelLoad; await expect(target).toHaveValue('7'); scenarios.push(stage);
    stage = 'refresh-during-write';
    held = { received: deferred(), release: deferred(), finished: deferred() }; fault = 'held';
    await save.click(); await waitForHeld(held.received.promise);
    await page.getByRole('button', { name: '새로고침', exact: true }).click(); held.release.resolve(); await waitForHeld(held.finished.promise);
    await page.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).click();
    await expect(save).toBeDisabled(); const beforeReadback = writes; await check().click();
    await expect(panel).toContainText('이후 편집한 내용은 아직 저장하지 않았어요.');
    // The existing publication review chooses the next published version (2), while the confirmed server save used 7.
    await expect(target).toHaveValue('2'); await target.fill('7'); await expect(confirmed()).toBeVisible();
    assert.equal(writes, beforeReadback); scenarios.push(stage);
    stage = 'mobile'; await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await panel.screenshot({ path: resolve(directory, 'server-draft-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 }); await panel.screenshot({ path: resolve(directory, 'server-draft-desktop.png') }); scenarios.push(stage);
    stage = 'owner-revoked'; await local.setRole('reader'); await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await expect(save).toBeDisabled(); await expect(load).toBeDisabled(); await expect(check()).toBeDisabled();
    assert.equal(await panel.locator('pre').count(), 0); scenarios.push(stage);
    assert.equal(await local.db.prepare("SELECT count(*) FROM project_schemas WHERE project_id='sembom'").first('count(*)'), 1);
    assert.equal(routeError, false); assert.equal(pageErrors, 0);
    const report = { verified: true, browser: browser.version(), scenarios, writes, reads, unloadDialogs, pageErrors, routeError, directory };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  }
} catch (error) {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, message: error.message, code: 'admin_server_draft_failed' }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, message: error.message, directory }));
} finally { clearTimeout(watchdog); held?.release.resolve(); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
