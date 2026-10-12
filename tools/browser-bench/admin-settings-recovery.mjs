import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { adminLoginFixture } from './admin-login-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const waitForHeld = async promise => {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('held_response_timeout')), 15000); })]); }
  finally { clearTimeout(timer); }
};
let local, server, browser, page, directory, watchdog, fault, held, stage = 'arguments';
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-settings-recovery -- [--channel chromium|chrome|msedge]\nLocal signed settings writes, lost-response readback and denied recovery; no remote service.');
  else {
    watchdog = setTimeout(() => { held?.release.resolve(); void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true });
    directory = await mkdtemp(resolve(root, '.tmp/admin-settings-recovery-'));
    stage = 'fixture'; local = await adminLoginFixture(directory, { profile: 'access' });
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
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
    browser = await chromium.launch({ channel: values.channel, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    let routeError = false, pageErrors = 0, attemptedWrites = 0, preCommitFailures = 0, droppedWrites = 0, timedOutWrites = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      try {
        if (url.origin === origin && url.pathname === '/v1/projects/sembom' && request.method() === 'PATCH') {
          attemptedWrites++;
          const current = fault; fault = null;
          if (current === 'before') {
            preCommitFailures++;
            return await route.fulfill({ status: 503, contentType: 'application/json',
              body: JSON.stringify({ error: { code: 'storage_unavailable', requestId: 'settings-recovery-fixture' } }) });
          }
          if (current === 'after') { droppedWrites++; return await local.route(route, { dropResponse: true }); }
          if (current === 'held') {
            const holding = held; timedOutWrites++;
            try { await local.route(route, { afterCommit: async () => { holding.committed.resolve(); await holding.release.promise; } }); }
            catch (error) { if (!holding.cancelExpected) throw error; }
            finally { holding.finished.resolve(); }
            return;
          }
        }
        await local.route(route);
      } catch {
        routeError = true; await route.abort().catch(() => {});
      }
    });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', () => pageErrors++);
    stage = 'login'; await page.goto(origin);
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const name = page.locator('#settings-name');
    const save = page.getByRole('button', { name: '변경 저장', exact: true });
    const recovery = page.getByRole('region', { name: '설정 충돌 확인', exact: true });
    const persisted = async () => (await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name;
    await name.waitFor(); await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === false);
    const initial = await persisted();
    const lockedDraft = async expected => {
      await recovery.getByText(/저장 결과를 확인하지 못했어요/).waitFor({ timeout: 20000 });
      assert.equal(await name.inputValue(), expected);
      assert.equal(await name.isEditable(), false); assert.equal(await save.isDisabled(), true);
    };
    const inspectComparison = async (serverName, draftName) => {
      await page.getByRole('button', { name: '최신 설정 확인', exact: true }).click();
      const cells = recovery.locator('.settings-diff tbody tr').first().locator('td');
      await cells.first().waitFor();
      assert.equal(await cells.nth(0).innerText(), serverName);
      assert.equal(await cells.nth(1).innerText(), draftName);
      assert.equal(await save.isDisabled(), true);
    };
    stage = 'pre-commit-failure'; fault = 'before';
    await name.fill('Uncommitted settings draft'); await save.click();
    await lockedDraft('Uncommitted settings draft'); assert.equal(await persisted(), initial);
    assert.equal(attemptedWrites, 1);
    await inspectComparison(initial, 'Uncommitted settings draft');
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).click();
    assert.equal(await name.inputValue(), 'Uncommitted settings draft'); assert.equal(attemptedWrites, 1);
    await save.click(); await page.getByText('프로젝트 설정을 저장했어요.', { exact: true }).waitFor();
    assert.equal(await persisted(), 'Uncommitted settings draft'); assert.equal(attemptedWrites, 2);

    stage = 'committed-lost-response'; fault = 'after';
    await name.fill('Committed response lost'); await save.click();
    await lockedDraft('Committed response lost'); assert.equal(await persisted(), 'Committed response lost');
    assert.equal(attemptedWrites, 3);
    await inspectComparison('Committed response lost', 'Committed response lost');
    await page.getByRole('button', { name: '서버 설정 사용', exact: true }).click();
    await save.click(); await page.getByText('변경한 설정이 없어요.', { exact: true }).waitFor();
    assert.equal(attemptedWrites, 3); assert.equal(await name.inputValue(), 'Committed response lost');

    stage = 'committed-response-timeout';
    held = { committed: deferred(), release: deferred(), finished: deferred(), cancelExpected: false };
    fault = 'held'; await name.fill('Committed response timed out'); await save.click();
    await waitForHeld(held.committed.promise);
    assert.equal(await persisted(), 'Committed response timed out');
    await lockedDraft('Committed response timed out'); held.cancelExpected = true;
    assert.equal(attemptedWrites, 4);
    await inspectComparison('Committed response timed out', 'Committed response timed out');
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).click();
    await save.click(); await page.getByText('변경한 설정이 없어요.', { exact: true }).waitFor();
    held.release.resolve(); await waitForHeld(held.finished.promise);
    assert.equal(await name.inputValue(), 'Committed response timed out');
    assert.equal(attemptedWrites, 4); assert.equal(await name.isEditable(), true);
    await page.getByText('변경한 설정이 없어요.', { exact: true }).waitFor();

    stage = 'denied-readback'; fault = 'after';
    await name.fill('Committed before role loss'); await save.click();
    await lockedDraft('Committed before role loss'); assert.equal(attemptedWrites, 5);
    await local.setRole('reader');
    await inspectComparison('Committed before role loss', 'Committed before role loss');
    assert.equal(await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).isDisabled(), true);
    assert.equal(await name.isEditable(), false);
    await page.getByRole('button', { name: '서버 설정 사용', exact: true }).click();
    assert.equal(await name.isEditable(), false); assert.equal(await save.isDisabled(), true);
    await local.setRole('owner');
    // The explicit header refresh invokes the editor's existing permission recovery path.
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === false);
    assert.equal(await name.inputValue(), 'Committed before role loss'); assert.equal(attemptedWrites, 5);
    assert.equal(await persisted(), 'Committed before role loss');
    assert.equal(preCommitFailures, 1); assert.equal(droppedWrites, 2); assert.equal(timedOutWrites, 1);
    assert.equal(local.counts.apiWrites, 4);
    assert.equal(routeError, false); assert.equal(pageErrors, 0);
    await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    assert.equal(await page.locator('#settings-name').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0);
    const report = { verified: true, browser: browser.version(), preCommitFailurePreservesDraft: true,
      committedLostResponseRecovered: true, readbackPreventsDuplicateWrite: true,
      nativeDeadlinePreservesCommittedDraft: true, lateTimedOutResponseIgnored: true,
      readOnlyRecoveryRemainsLocked: true, explicitOwnerRecovery: true, disconnectedUiCleared: true,
      attemptedWrites, preCommitFailures, droppedWrites, timedOutWrites, pageErrors, routeError, ...local.counts };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
} catch {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, code: 'admin_settings_recovery_failed', counts: local?.counts }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, code: 'admin_settings_recovery_failed' }));
} finally {
  clearTimeout(watchdog);
  held?.release.resolve();
  await browser?.close(); await server?.close(); await local?.mf.dispose();
}
