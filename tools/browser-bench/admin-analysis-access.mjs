import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { Provisioner } from '../provision/store.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let local, server, browser, page, directory, watchdog, held, stage = 'fixture';
try {
  watchdog = setTimeout(() => { held?.release.resolve(); void browser?.close(); }, 60000);
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-analysis-access-'));
  local = await adminLoginFixture(directory, { profile: 'access' });
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
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  let routeError = false, pageErrors = 0, deniedReads = 0, heldReads = 0, invalidZoneReads = 0;
  let invalidProjectZone = true;
  await context.route('**/*', async route => {
    const holding = held && !held.used && route.request().url().startsWith(`${origin}/v1/projects/sembom/events/tool_view/daily`) ? held : null;
    try {
      if (invalidProjectZone && new URL(route.request().url()).origin === origin && new URL(route.request().url()).pathname === '/v1/projects') {
        const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
        try {
          assert.equal(response.status(), 200);
          const body = await response.json(); body.data[0].timeZone = 'Mars/Olympus'; invalidZoneReads++;
          return await route.fulfill({ response, json: body });
        } finally { await response.dispose(); }
      }
      if (!holding) return await local.route(route);
      holding.used = true; heldReads++;
      const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
      try {
        assert.equal(response.status(), 403); holding.received.resolve(); await holding.release.promise;
        await route.fulfill({ response });
      } finally { await response.dispose(); }
    } catch {
      if (!holding) routeError = true;
      await route.abort().catch(() => {});
    } finally { holding?.finished.resolve(); }
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', () => pageErrors++);
  page.on('response', response => { if (response.status() === 403 && new URL(response.url()).pathname.includes('/events/')) deniedReads++; });
  stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  stage = 'invalid-time-zone';
  await page.getByRole('heading', { name: '응답이 계약과 맞지 않아요', exact: true }).waitFor();
  assert.equal(pageErrors, 0);
  assert.equal(await page.locator('.event-table').count(), 0);
  stage = 'time-zone-recovery'; invalidProjectZone = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await page.getByRole('button', { name: '이벤트 분석', exact: true }).click();
  const csv = page.getByRole('button', { name: 'CSV 내려받기', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  stage = 'revoke'; const provisioner = new Provisioner(local.db);
  await provisioner.apply(await provisioner.plan('revoke', { projectId: 'sembom', issuer: local.issuer, subject: 'synthetic-login-operator' }));
  await page.getByRole('button', { name: 'tool_view', exact: true }).click();
  await page.getByRole('heading', { name: '이 프로젝트를 볼 권한이 없어요', exact: true }).waitFor();
  assert.equal(deniedReads, 1);
  const closeDetail = page.getByRole('button', { name: '상세 닫기', exact: true });
  if (await closeDetail.count()) await closeDetail.click();
  stage = 'denied-export'; assert.equal(await csv.isDisabled(), true);
  assert.equal(await page.locator('.event-table').count(), 0);
  stage = 'other-project'; await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  const downloadPromise = page.waitForEvent('download'); await csv.click();
  const download = await downloadPromise; assert.ok(download.suggestedFilename().startsWith('tallyfin-access-other-'));
  const exported = await readFile(await download.path(), 'utf8');
  assert.ok(exported.split('\r\n', 1)[0].endsWith(',"query_source"'));
  assert.ok(exported.includes('"access-other"')); assert.equal(exported.includes('"sembom"'), false);
  stage = 'restore'; await local.setRole('owner');
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  stage = 'late-denial';
  await provisioner.apply(await provisioner.plan('revoke', { projectId: 'sembom', issuer: local.issuer, subject: 'synthetic-login-operator' }));
  held = { used: false, received: deferred(), release: deferred(), finished: deferred() };
  await page.getByRole('button', { name: 'tool_view', exact: true }).click();
  let holdTimer;
  try { await Promise.race([held.received.promise, new Promise((_, reject) => {
    holdTimer = setTimeout(() => reject(Error('held_read_timeout')), 10000);
  })]); } finally { clearTimeout(holdTimer); }
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  held.release.resolve(); await held.finished.promise;
  assert.equal(await csv.isEnabled(), true);
  assert.equal(await page.getByRole('heading', { name: '이 프로젝트를 볼 권한이 없어요', exact: true }).count(), 0);
  stage = 'disconnect'; await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
  await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
  assert.equal(await csv.count(), 0); assert.equal(await page.locator('.event-table').count(), 0);
  assert.equal(routeError, false); assert.equal(pageErrors, 0);
  const report = { verified: true, browser: browser.version(), invalidZoneReads, invalidZoneRecovery: true, deniedReads, deniedSummaryCleared: true, deniedCsvDisabled: true,
    otherProjectExportIsolated: true, recovery: true, lateDeniedReadIgnored: true, heldReads, disconnectClears: true, routeError, pageErrors, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, verified: false }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage }));
} finally { clearTimeout(watchdog); held?.release.resolve(); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
