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
let local, server, browser, page, directory, watchdog, held, stage = 'arguments';
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-access -- [--channel chromium|chrome|msedge]\nLocal signed owner/reader checks and committed-write responses across project switch/disconnect; no remote service.');
  else {
    watchdog = setTimeout(() => { held?.release.resolve(); void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true }); directory = await mkdtemp(resolve(root, '.tmp/admin-access-'));
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
    await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`; local.configure(origin);
    browser = await chromium.launch({ channel: values.channel, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    let routeError = false, pageErrors = 0, deniedValidations = 0, deniedSettings = 0, heldWrites = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const holding = url.origin === origin && request.method() === 'PATCH' && held && !held.used && url.pathname === held.path ? held : null;
      try {
        if (holding) {
          holding.used = true; heldWrites++;
          await local.route(route, { afterCommit: async () => { holding.committed.resolve(); await holding.release.promise; } });
        } else await local.route(route);
      } catch { if (!holding?.cancelExpected) routeError = true; await route.abort().catch(() => {}); }
      finally { holding?.finished.resolve(); }
    });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', () => pageErrors++);
    page.on('response', response => {
      if (response.status() === 403 && new URL(response.url()).pathname.endsWith('/schemas/validate')) deniedValidations++;
      if (response.status() === 403 && response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/v1/projects/sembom') deniedSettings++;
    });
    stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const schema = page.locator('.schema-section'), label = page.locator('#schema-event-0-label');
    await label.waitFor(); assert.equal(await label.isEditable(), true);
    stage = 'permission-denial'; await label.fill('Preserved permission draft');
    await page.locator('#settings-name').fill('Preserved settings draft');
    await local.setRole('reader');
    await schema.getByRole('button', { name: '정의 검증', exact: true }).click();
    await schema.getByText('읽기 전용', { exact: true }).waitFor();
    assert.equal(deniedValidations, 1); assert.equal(await label.isEditable(), false);
    assert.equal(await label.inputValue(), 'Preserved permission draft');
    assert.equal(await schema.getByRole('button', { name: '정의 검증', exact: true }).isDisabled(), true);
    assert.equal(await schema.getByRole('button', { name: '새 버전 발행 (v2)', exact: true }).isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('settings-name')?.disabled === true);
    assert.equal(await page.locator('#settings-name').inputValue(), 'Preserved settings draft');
    assert.equal(await page.getByRole('button', { name: '변경 저장', exact: true }).isDisabled(), true);
    const writesAtDenial = local.counts.apiWrites;
    await schema.getByRole('button', { name: '서버 상태 확인', exact: true }).click();
    await schema.getByText('읽기 전용', { exact: true }).waitFor();
    assert.equal(await schema.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).isDisabled(), true);
    assert.equal(await label.inputValue(), 'Preserved permission draft'); assert.equal(local.counts.apiWrites, writesAtDenial);
    stage = 'permission-restoration'; await local.setRole('owner');
    await page.getByRole('button', { name: '최신 설정 확인', exact: true }).click();
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).click();
    assert.equal(await page.locator('#settings-name').isEditable(), true);
    await schema.getByRole('button', { name: '서버 상태 확인', exact: true }).click();
    await schema.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).click();
    assert.equal(await label.isEditable(), true); assert.equal(await label.inputValue(), 'Preserved permission draft');
    assert.equal(await schema.getByRole('checkbox', { name: '정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.', exact: true }).isChecked(), false);
    await schema.getByRole('button', { name: '정의 검증', exact: true }).click();
    await schema.getByText('정의 검증을 통과했어요. 개인정보 검토를 확인한 뒤 발행해 주세요.', { exact: true }).waitFor();
    stage = 'settings-permission-denial';
    await local.setRole('reader');
    await page.getByRole('button', { name: '변경 저장', exact: true }).click();
    await schema.getByText('읽기 전용', { exact: true }).waitFor();
    assert.equal(deniedSettings, 1); assert.equal(await label.isEditable(), false);
    assert.equal(await label.inputValue(), 'Preserved permission draft');
    assert.equal(await page.locator('#settings-name').inputValue(), 'Preserved settings draft');
    assert.equal(await page.getByRole('button', { name: '변경 저장', exact: true }).isDisabled(), true);
    stage = 'settings-permission-restoration'; await local.setRole('owner');
    await page.getByRole('button', { name: '최신 설정 확인', exact: true }).click();
    await page.getByRole('button', { name: '내 변경 유지하고 검토', exact: true }).click();
    await schema.getByRole('button', { name: '서버 상태 확인', exact: true }).click();
    await schema.getByRole('button', { name: '초안 유지하고 다시 검토', exact: true }).click();
    assert.equal(await label.isEditable(), true);
    assert.equal(await page.locator('#settings-name').isEditable(), true);
    const beginHeldWrite = async (projectId, name) => {
      held = { path: `/v1/projects/${projectId}`, used: false, cancelExpected: false, committed: deferred(), release: deferred(), finished: deferred() };
      await page.locator('#settings-name').fill(name);
      await page.getByRole('button', { name: '변경 저장', exact: true }).click();
      let timeout;
      try { await Promise.race([held.committed.promise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('held_write_timeout')), 15000);
      })]); } finally { clearTimeout(timeout); }
      return held;
    };
    stage = 'project-switch'; const first = await beginHeldWrite('sembom', 'Committed old project'); first.cancelExpected = true;
    await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other');
    await page.waitForFunction(() => document.getElementById('settings-name')?.value === 'Other access fixture');
    first.release.resolve(); await first.finished.promise;
    assert.equal(await page.locator('#settings-name').inputValue(), 'Other access fixture');
    assert.notEqual(await label.inputValue(), 'Preserved permission draft');
    assert.equal((await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('sembom').first()).name, 'Committed old project');
    stage = 'disconnect'; const second = await beginHeldWrite('access-other', 'Committed before disconnect'); second.cancelExpected = true;
    await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
    await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
    second.release.resolve(); await second.finished.promise;
    assert.equal(await page.locator('#settings-name').count(), 0); assert.equal(await label.count(), 0);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await context.cookies()).length, 0);
    assert.equal((await local.db.prepare('SELECT name FROM projects WHERE id = ?').bind('access-other').first()).name, 'Committed before disconnect');
    assert.equal(routeError, false); assert.equal(pageErrors, 0); assert.equal(heldWrites, 2);
    const report = { verified: true, browser: browser.version(), deniedValidations, deniedSettings, crossSectionPermissionsRefreshed: true, preservedDraft: true, explicitPermissionRecovery: true,
      staleWriteAcrossProjectSwitchIgnored: true, disconnectedUiCleared: true, serverCommitsNotRolledBack: true,
      heldWrites, routeError, pageErrors, ...local.counts };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  }
} catch {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, code: 'admin_access_failed', counts: local?.counts }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, code: 'admin_access_failed' }));
} finally {
  clearTimeout(watchdog); held?.release.resolve(); await browser?.close(); await server?.close(); await local?.mf.dispose();
}
