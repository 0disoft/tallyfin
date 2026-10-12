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
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, 'check-creation-draft': { type: 'boolean' }, 'check-authority-drafts': { type: 'boolean' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-mode-exit -- [--channel chromium|chrome|msedge] [--check-creation-draft] [--check-authority-drafts]\nActual /demo API exit confirmation with ephemeral signed authority and isolated local D1; no remote service.');
  else {
    watchdog = setTimeout(() => { void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true }); directory = await mkdtemp(resolve(root, '.tmp/admin-mode-exit-'));
    stage = 'fixture'; local = await adminLoginFixture(directory, { profile: 'access', allowCreation: Boolean(values['check-creation-draft']),
      allowAuthorityChanges: Boolean(values['check-authority-drafts']) });
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
    let pageErrors = 0, routeError = false, loseCreation = false, droppedCreationResponses = 0, loseAuthority = null, droppedAuthorityResponses = 0;
    await context.route('**/*', async route => {
      try {
        const request = route.request(), url = new URL(request.url());
        const dropCreation = loseCreation && request.method() === 'POST' && url.origin === origin && url.pathname === '/v1/projects';
        const dropAuthority = loseAuthority && request.method() === 'PUT' && url.origin === origin && url.pathname === loseAuthority;
        const dropResponse = Boolean(dropCreation || dropAuthority);
        if (dropCreation) { loseCreation = false; droppedCreationResponses++; }
        if (dropAuthority) { loseAuthority = null; droppedAuthorityResponses++; }
        await local.route(route, { dropResponse });
      } catch { routeError = true; await route.abort().catch(() => {}); }
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
    const noDialog = async action => {
      let unexpected = false;
      const dismiss = async dialog => { unexpected = true; await dialog.dismiss(); };
      page.on('dialog', dismiss);
      try { await action(); assert.equal(unexpected, false); }
      finally { page.off('dialog', dismiss); }
    };
    if (values['check-creation-draft']) {
      const add = page.getByRole('button', { name: '프로젝트 추가', exact: true });
      const form = page.locator('.project-create'), creationName = page.locator('#create-name');
      const close = form.getByRole('button', { name: '닫기', exact: true });
      stage = 'empty-creation-close'; await add.click(); await creationName.waitFor(); await noDialog(() => close.click());
      stage = 'dirty-creation-close-cancel'; await add.click(); await creationName.fill('Creation exit draft');
      await answerConfirm(page, () => close.click(), false);
      assert.equal(await creationName.inputValue(), 'Creation exit draft');
      await answerConfirm(page, () => close.click(), true); assert.equal(await creationName.count(), 0);
      await add.click(); assert.equal(await creationName.inputValue(), '');
      await creationName.fill('Creation exit draft'); await page.locator('#create-id').fill('creation-draft-test');
      await page.locator('#create-timeZone').fill('Asia/Seoul');
      stage = 'creation-project-switch'; await noDialog(() => project.selectOption('access-other'));
      assert.equal(await creationName.inputValue(), 'Creation exit draft');
      stage = 'creation-disconnect-cancel';
      await answerConfirm(page, () => page.getByRole('button', { name: '연결 끊기', exact: true }).click(), false);
      assert.equal(await project.inputValue(), 'access-other'); assert.equal(await creationName.inputValue(), 'Creation exit draft');
      stage = 'creation-mode-cancel'; await answerConfirm(page, () => sample.click(), false);
      assert.equal(await api.getAttribute('aria-pressed'), 'true'); assert.equal(await creationName.inputValue(), 'Creation exit draft');
      stage = 'creation-reload-cancel'; let observed = false;
      const dismiss = async dialog => { assert.equal(dialog.type(), 'beforeunload'); observed = true; await dialog.dismiss(); };
      page.once('dialog', dismiss);
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 1500 }).catch(error => {
          if (!observed || !(error.name === 'TimeoutError' || /ERR_ABORTED/.test(error.message))) throw error;
        });
        assert.equal(observed, true);
      } finally { page.off('dialog', dismiss); }
      assert.equal(await creationName.inputValue(), 'Creation exit draft');
      stage = 'creation-lost-response'; loseCreation = true;
      await form.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
      const confirm = form.getByRole('button', { name: '같은 요청으로 생성 확인', exact: true }); await confirm.waitFor();
      assert.equal((await local.db.prepare('SELECT count(*) AS n FROM projects WHERE id = ?').bind('creation-draft-test').first()).n, 1);
      assert.equal(local.counts.apiWrites, 1); assert.equal(await creationName.isDisabled(), true);
      stage = 'uncertain-creation-disconnect-cancel';
      await answerConfirm(page, () => page.getByRole('button', { name: '연결 끊기', exact: true }).click(), false);
      assert.equal(await confirm.count(), 1); assert.equal(local.counts.apiWrites, 1);
      stage = 'creation-confirm'; await noDialog(() => confirm.click());
      await page.waitForFunction(() => document.querySelector('select[aria-label="프로젝트 선택"]')?.value === 'creation-draft-test');
      assert.equal(await creationName.count(), 0); assert.equal(local.counts.apiWrites, 2); assert.equal(droppedCreationResponses, 1);
      assert.equal((await local.db.prepare('SELECT count(*) AS n FROM projects WHERE id = ?').bind('creation-draft-test').first()).n, 1);
      await noDialog(() => project.selectOption('sembom'));
    }
    const navigation = page.getByRole('navigation', { name: '주요 탐색', exact: true });
    await navigation.getByRole('button', { name: '설정', exact: true }).click();
    const name = page.locator('#settings-name'), label = page.locator('#schema-event-0-label');
    await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === false && document.getElementById('schema-event-0-label')?.disabled === false);
    const initialName = (await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name;
    if (values['check-authority-drafts']) {
      stage = 'authority-start'; assert.equal(await project.inputValue(), 'sembom');
      const cancelReload = async () => {
        let observed = false;
        const dismiss = async dialog => { assert.equal(dialog.type(), 'beforeunload'); observed = true; await dialog.dismiss(); };
        page.once('dialog', dismiss);
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 1500 }).catch(error => {
            if (!observed || !(error.name === 'TimeoutError' || /ERR_ABORTED/.test(error.message))) throw error;
          });
          assert.equal(observed, true);
        } finally { page.off('dialog', dismiss); }
      };
      for (const [kind, disclosure, section] of [['grant', '계정 권한 추가', '.grants-section'], ['publisher', '발행자 추가', '.publishers-section']]) {
        const issuer = page.locator(`#${kind}-add-issuer`), subject = page.locator(`#${kind}-add-subject`);
        await page.getByText(disclosure, { exact: true }).click();
        await page.waitForFunction(id => document.getElementById(id)?.disabled === false, `${kind}-add-issuer`);
        await issuer.fill('https://draft.example.invalid'); await subject.fill(`unsaved-${kind}`);
        stage = `${kind}-project-switch-cancel`; await answerConfirm(page, () => project.selectOption('access-other'), false);
        assert.equal(await project.inputValue(), 'sembom'); assert.equal(await subject.inputValue(), `unsaved-${kind}`);
        stage = `${kind}-reload-cancel`; await cancelReload();
        assert.equal(await subject.inputValue(), `unsaved-${kind}`);
        await navigation.getByRole('button', { name: '이벤트 분석', exact: true }).click();
        stage = `${kind}-hidden-mode-cancel`; await answerConfirm(page, () => sample.click(), false);
        stage = `${kind}-hidden-disconnect-cancel`; await answerConfirm(page, () => page.getByRole('button', { name: '연결 끊기', exact: true }).click(), false);
        assert.equal(await subject.inputValue(), `unsaved-${kind}`);
        await navigation.getByRole('button', { name: '설정', exact: true }).click();
        await page.waitForFunction(id => document.getElementById(id)?.disabled === false, `${kind}-add-issuer`);
        assert.equal(await subject.inputValue(), `unsaved-${kind}`);
        stage = `${kind}-review-cancel`;
        await page.locator(section).getByRole('button', { name: '추가 내용 확인', exact: true }).click();
        await answerConfirm(page, () => project.selectOption('access-other'), false);
        await navigation.getByRole('button', { name: '이벤트 분석', exact: true }).click();
        await navigation.getByRole('button', { name: '설정', exact: true }).click();
        await page.locator(section).getByRole('heading', { name: kind === 'grant' ? '권한 변경 확인' : '발행 권한 변경 확인', exact: true }).waitFor();
        const resetList = page.locator(section).getByRole('button', { name: '처음부터 새로고침', exact: true });
        stage = `${kind}-review-refresh-cancel`; await answerConfirm(page, () => resetList.click(), false);
        assert.equal(await page.locator(section).getByRole('button', { name: '취소', exact: true }).count(), 1);
        await answerConfirm(page, () => resetList.click(), true);
        await page.waitForFunction(id => document.getElementById(id)?.disabled === false, `${kind}-add-subject`);
        await issuer.fill(''); await subject.fill('');
        assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
        if (kind === 'grant') {
          await page.locator('#grant-add-role').selectOption('owner');
          await answerConfirm(page, () => project.selectOption('access-other'), false);
          await page.locator('#grant-add-role').selectOption('reader');
          assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
        }
        stage = `${kind}-lost-response`;
        await issuer.fill('https://draft.example.invalid'); await subject.fill(`unsaved-${kind}`);
        await page.locator(section).getByRole('button', { name: '추가 내용 확인', exact: true }).click();
        loseAuthority = `/v1/projects/sembom/${kind === 'grant' ? 'grants' : 'publishers'}`;
        await page.locator(section).getByRole('button', { name: kind === 'grant' ? '역할 변경 저장' : '권한 부여 저장', exact: true }).click();
        const reconfirm = page.locator(section).getByRole('button', { name: '같은 요청으로 다시 확인', exact: true });
        await reconfirm.waitFor();
        const rowCount = () => local.db.prepare(`SELECT count(*) AS n FROM ${kind === 'grant' ? 'project_grants' : 'project_publishers'} WHERE project_id=? AND issuer=? AND subject=?`)
          .bind('sembom', 'https://draft.example.invalid', `unsaved-${kind}`).first('n');
        assert.equal(await rowCount(), 1);
        stage = `${kind}-uncertain-exit-cancel`;
        await answerConfirm(page, () => project.selectOption('access-other'), false);
        await answerConfirm(page, () => page.getByRole('button', { name: '연결 끊기', exact: true }).click(), false);
        await answerConfirm(page, () => sample.click(), false); await cancelReload();
        assert.equal(await reconfirm.count(), 1); assert.equal(await subject.inputValue(), `unsaved-${kind}`);
        stage = `${kind}-same-request-confirm`; await reconfirm.click();
        await page.waitForFunction(id => document.getElementById(id)?.value === '' && document.getElementById(id)?.disabled === false, `${kind}-add-subject`);
        assert.equal(await rowCount(), 1);
        assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
      }
      // A row action has no raw add-form input; its reviewed request must still guard exit.
      stage = 'grant-row-review-cancel';
      await page.getByRole('button', { name: 'synthetic-backup-operator 조회로 변경', exact: true }).click();
      await answerConfirm(page, () => sample.click(), false);
      await page.locator('.grants-section').getByRole('button', { name: '취소', exact: true }).click();
      assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true);
      await page.locator('#grant-add-subject').fill('Discard only on approved exit');
      await page.locator('#publisher-add-subject').fill('Discard only on approved exit');
    }
    await name.fill('Mode exit draft'); await label.fill('Mode exit schema');
    stage = 'same-mode'; await noDialog(() => api.click());
    assert.equal(await name.inputValue(), 'Mode exit draft'); assert.equal(await label.inputValue(), 'Mode exit schema');
    if (values['check-authority-drafts']) {
      assert.equal(await page.locator('#grant-add-subject').inputValue(), 'Discard only on approved exit');
      assert.equal(await page.locator('#publisher-add-subject').inputValue(), 'Discard only on approved exit');
    }
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
    if (values['check-authority-drafts']) {
      assert.equal(await page.locator('#grant-add-subject').count(), 0); assert.equal(await page.locator('#publisher-add-subject').count(), 0);
    }
    stage = 'api-reentry'; await api.click(); await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('#api-token').inputValue(), ''); assert.equal(await project.count(), 0);
    assert.equal(await name.count(), 0); assert.equal(await label.count(), 0);
    stage = 'clean-exit'; await noDialog(() => sample.click());
    assert.equal(await sample.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0);
    assert.equal(local.counts.apiWrites, (values['check-creation-draft'] ? 2 : 0) + (values['check-authority-drafts'] ? 4 : 0));
    assert.equal(droppedAuthorityResponses, values['check-authority-drafts'] ? 2 : 0);
    assert.equal((await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name, initialName);
    assert.equal(pageErrors, 0); assert.equal(routeError, false);
    const report = { verified: true, browser: browser.version(), signedManualDemoConnection: true, hiddenDraftExitCanceled: true,
      canceledModeRetainsDraftsAndSelection: true, acceptedModeDisposesApiWorkspace: true, apiReentryRequiresConnection: true,
      sameModeAndCleanExitDoNotWarn: true, noStorageOrCookie: true, creationDraftChecked: Boolean(values['check-creation-draft']),
      authorityDraftsChecked: Boolean(values['check-authority-drafts']), droppedCreationResponses, droppedAuthorityResponses, pageErrors, routeError, ...local.counts };
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
