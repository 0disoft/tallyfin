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
let local, server, browser, page, directory, watchdog, unloadProbe, stage = 'arguments';
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, 'check-unload': { type: 'boolean' }, 'check-created-exit': { type: 'boolean' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-settings-navigation -- [--channel chromium|chrome|msedge] [--check-unload] [--check-created-exit]\nLocal signed settings/schema drafts across navigation and permission refresh; no remote service.');
  else {
    watchdog = setTimeout(() => { void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true }); directory = await mkdtemp(resolve(root, '.tmp/admin-settings-navigation-'));
    stage = 'fixture'; local = await adminLoginFixture(directory, { profile: 'access', allowCreation: Boolean(values['check-created-exit']) });
    const expectedWrites = values['check-created-exit'] ? 1 : 0;
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
      try { await local.route(route); }
      catch { routeError = true; await route.abort().catch(() => {}); }
    });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', () => pageErrors++);
    await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
    const navigation = page.getByRole('navigation', { name: '주요 탐색', exact: true });
    const enter = async () => { await navigation.getByRole('button', { name: '설정', exact: true }).click(); await page.locator('#settings-name').waitFor(); };
    const leave = async () => { await navigation.getByRole('button', { name: '이벤트 분석', exact: true }).click(); await page.getByRole('heading', { name: '이벤트 분석', exact: true }).waitFor(); };
    const name = page.locator('#settings-name'), label = page.locator('#schema-event-0-label');
    await enter(); await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === false && document.getElementById('schema-event-0-label')?.disabled === false);
    const initialName = (await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name;
    let unloadWarnings = 0;
    const cancelReload = async () => {
      let observed = false;
      unloadProbe = { installed: await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), dialogs: 0, aborted: false, timedOut: false };
      const dismiss = async dialog => { assert.equal(dialog.type(), 'beforeunload'); observed = true; unloadProbe.dialogs++; unloadWarnings++; await dialog.dismiss(); };
      page.once('dialog', dismiss);
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 1500 }).catch(error => {
          unloadProbe.aborted = /ERR_ABORTED/.test(error.message);
          unloadProbe.timedOut = error.name === 'TimeoutError';
          if (!observed || !(unloadProbe.aborted || unloadProbe.timedOut)) throw error;
        });
        assert.equal(observed, true);
      } finally { page.off('dialog', dismiss); }
    };
    const cancelTabClose = async () => {
      let finish, fail, timer;
      const handled = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      const dismiss = async dialog => {
        try { assert.equal(dialog.type(), 'beforeunload'); unloadWarnings++; await dialog.dismiss(); finish(); }
        catch (error) { fail(error); }
      };
      page.once('dialog', dismiss);
      try {
        timer = setTimeout(() => fail(Error('tab_close_dialog_missing')), 5000);
        await Promise.all([page.close({ runBeforeUnload: true }), handled]);
        assert.equal(page.isClosed(), false);
      } finally { clearTimeout(timer); page.off('dialog', dismiss); }
    };
    await name.fill('Retained navigation settings');
    const projectSelect = page.getByRole('combobox', { name: '프로젝트 선택', exact: true });
    if (values['check-unload']) {
      stage = 'dirty-settings-reload'; await cancelReload();
      assert.equal(await name.inputValue(), 'Retained navigation settings');
      stage = 'settings-project-switch-cancel';
      await answerConfirm(page, () => projectSelect.selectOption('access-other'), false);
      assert.equal(await projectSelect.inputValue(), 'sembom');
      assert.equal(await name.inputValue(), 'Retained navigation settings');
      await name.fill(initialName); await label.fill('Retained navigation schema');
      stage = 'dirty-schema-reload'; await cancelReload();
      assert.equal(await label.inputValue(), 'Retained navigation schema');
      stage = 'schema-project-switch-cancel';
      await answerConfirm(page, () => projectSelect.selectOption('access-other'), false);
      assert.equal(await projectSelect.inputValue(), 'sembom');
      assert.equal(await label.inputValue(), 'Retained navigation schema');
      await name.fill('Retained navigation settings');
    }
    stage = 'draft-return'; await label.fill('Retained navigation schema');
    await leave(); assert.equal(await name.isVisible(), false); assert.equal(await label.isVisible(), false);
    if (values['check-unload']) {
      stage = 'hidden-drafts-reload'; await cancelReload();
      stage = 'hidden-drafts-tab-close'; await cancelTabClose();
    }
    stage = 'hidden-project-switch-cancel';
    await answerConfirm(page, () => projectSelect.selectOption('access-other'), false);
    assert.equal(await projectSelect.inputValue(), 'sembom');
    assert.equal(await name.inputValue(), 'Retained navigation settings');
    assert.equal(await label.inputValue(), 'Retained navigation schema');
    stage = 'hidden-disconnect-cancel';
    await answerConfirm(page, () => page.getByRole('button', { name: '연결 끊기', exact: true }).click(), false);
    assert.equal(await projectSelect.inputValue(), 'sembom');
    assert.equal(await page.getByRole('button', { name: '관리자 로그인', exact: true }).count(), 0);
    assert.equal(await name.inputValue(), 'Retained navigation settings');
    assert.equal(await label.inputValue(), 'Retained navigation schema');
    if (values['check-created-exit']) {
      stage = 'created-project-cancel';
      await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click();
      await page.locator('#create-name').fill('Created exit fixture');
      await page.locator('#create-id').fill('draft-exit-new');
      await page.locator('#create-timeZone').fill('Asia/Seoul');
      await answerConfirm(page, () => page.getByRole('button', { name: '프로젝트 만들기', exact: true }).click(), false);
      await page.getByText('프로젝트 생성은 완료됐어요. 화면 이동은 취소했어요. 준비되면 생성한 프로젝트 열기를 눌러 주세요.', { exact: true }).waitFor();
      assert.equal(await projectSelect.inputValue(), 'sembom');
      assert.equal(await projectSelect.locator('option[value="draft-exit-new"]').count(), 1);
      assert.equal(await name.inputValue(), 'Retained navigation settings');
      assert.equal(await label.inputValue(), 'Retained navigation schema');
      assert.equal((await local.db.prepare('SELECT count(*) AS n FROM projects WHERE id = ?').bind('draft-exit-new').first()).n, 1);
      stage = 'created-project-reopen-cancel';
      await answerConfirm(page, () => page.getByRole('button', { name: '생성한 프로젝트 열기', exact: true }).click(), false);
      assert.equal(await projectSelect.inputValue(), 'sembom');
      assert.equal(await name.inputValue(), 'Retained navigation settings');
      assert.equal(await label.inputValue(), 'Retained navigation schema');
      assert.equal(local.counts.apiWrites, 1);
    }
    stage = 'draft-return';
    await enter();
    await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === false || document.querySelector('.settings-recovery'));
    assert.equal(await name.inputValue(), 'Retained navigation settings');
    assert.equal(await label.inputValue(), 'Retained navigation schema');
    // Returning rechecks permission and requires an explicit comparison choice.
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).click();
    await page.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).click();
    assert.equal(await name.isEditable(), true); assert.equal(await label.isEditable(), true);
    assert.equal(local.counts.apiWrites, expectedWrites);
    assert.equal((await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name, initialName);
    stage = 'revoked-while-away'; await leave(); await local.setRole('reader'); await enter();
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.schema-section')?.textContent.includes('읽기 전용'));
    assert.equal(await name.inputValue(), 'Retained navigation settings'); assert.equal(await label.inputValue(), 'Retained navigation schema');
    assert.equal(await name.isEditable(), false); assert.equal(await label.isEditable(), false);
    assert.equal(await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).isDisabled(), true);
    stage = 'scope-disposal'; await leave();
    if (values['check-created-exit']) {
      stage = 'created-project-open-accept';
      await answerConfirm(page, () => page.getByRole('button', { name: '생성한 프로젝트 열기', exact: true }).click(), true);
      await page.waitForFunction(() => document.getElementById('settings-name')?.value === 'Created exit fixture');
      assert.equal(await projectSelect.inputValue(), 'draft-exit-new');
      assert.equal(await label.count(), 0); assert.equal(local.counts.apiWrites, 1);
      await projectSelect.selectOption('access-other');
    } else await answerConfirm(page, () => projectSelect.selectOption('access-other'), true);
    await enter(); await page.waitForFunction(() => document.getElementById('settings-name')?.value === 'Other access fixture');
    assert.notEqual(await label.inputValue(), 'Retained navigation schema');
    await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
    await page.waitForFunction(initial => document.getElementById('settings-name')?.value === initial, initialName);
    assert.notEqual(await label.inputValue(), 'Retained navigation schema');
    await leave(); await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await name.count(), 0); assert.equal(await label.count(), 0);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0);
    assert.equal(local.counts.apiWrites, expectedWrites); assert.equal(pageErrors, 0); assert.equal(routeError, false);
    if (values['check-unload']) {
      stage = 'clean-disconnect-reload';
      const unexpected = async dialog => { unloadWarnings++; await dialog.dismiss(); };
      page.on('dialog', unexpected);
      try { await page.reload(); await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor(); }
      finally { page.off('dialog', unexpected); }
      assert.equal(unloadWarnings, 4);
    }
    const report = { verified: true, browser: browser.version(), settingsDraftRetained: true, schemaDraftRetained: true,
      hiddenControlsNotVisible: true, permissionRecheckedOnReturn: true, revokedDraftsRemainLocked: true,
      projectSwitchDisposesDrafts: true, disconnectDisposesHiddenWorkspace: true, noStorageOrCookie: true,
      canceledProjectSwitchRetainsDrafts: true, canceledDisconnectRetainsSession: true,
      independentEditorExitChecked: Boolean(values['check-unload']),
      createdProjectExitChecked: Boolean(values['check-created-exit']),
      unloadChecked: Boolean(values['check-unload']), tabCloseCanceled: Boolean(values['check-unload']), unloadWarnings, pageErrors, routeError, ...local.counts };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  }
} catch {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, code: 'admin_settings_navigation_failed', counts: local?.counts, unloadProbe }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, code: 'admin_settings_navigation_failed' }));
} finally {
  clearTimeout(watchdog); await browser?.close(); await server?.close(); await local?.mf.dispose();
}
