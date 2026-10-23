import assert from 'node:assert/strict';
import { CSV_COLUMNS } from '../../apps/admin/src/api/csv-export.ts';
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
  await local.db.prepare(`INSERT INTO project_schemas (project_id, version, status, definitions_json, published_at, retired_at)
    SELECT project_id, 2, 'active', definitions_json, published_at, NULL FROM project_schemas WHERE project_id='access-other' AND version=1`).run();
  await local.db.prepare(`INSERT INTO project_schemas (project_id, version, status, definitions_json, published_at, retired_at)
    SELECT project_id, 3, 'retired', definitions_json, published_at, published_at FROM project_schemas WHERE project_id='access-other' AND version=1`).run();
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
  let routeError = false, pageErrors = 0, deniedReads = 0, heldReads = 0, invalidZoneReads = 0, mismatchedEventZoneReads = 0, oversizedReads = 0;
  let trackingEventReads = false, eventWorkflowReads = 0;
  let oversizedProjectPage = true, invalidProjectZone = true, mismatchedEventZone = true;
  await context.route('**/*', async route => {
    if (trackingEventReads && new URL(route.request().url()).pathname.includes('/workflows/')) eventWorkflowReads++;
    const holding = held && !held.used && route.request().url().startsWith(`${origin}/v1/projects/sembom/events/tool_view/daily`) ? held : null;
    try {
      if (oversizedProjectPage && new URL(route.request().url()).origin === origin && new URL(route.request().url()).pathname === '/v1/projects') {
        const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
        try {
          assert.equal(response.status(), 200); oversizedReads++;
          return await route.fulfill({ response, body: (await response.text()) + ' '.repeat(4 * 1024 * 1024 + 1) });
        } finally { await response.dispose(); }
      }
      if (invalidProjectZone && new URL(route.request().url()).origin === origin && new URL(route.request().url()).pathname === '/v1/projects') {
        const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
        try {
          assert.equal(response.status(), 200);
          const body = await response.json(); body.data[0].timeZone = 'Mars/Olympus'; invalidZoneReads++;
          return await route.fulfill({ response, json: body });
        } finally { await response.dispose(); }
      }
      if (mismatchedEventZone && route.request().url().startsWith(`${origin}/v1/projects/sembom/events/tool_view/daily`)) {
        const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
        try {
          assert.equal(response.status(), 200);
          const body = await response.json(); body.meta.timeZone = 'America/New_York'; mismatchedEventZoneReads++;
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
  stage = 'oversized-response';
  await page.getByRole('heading', { name: '응답이 계약과 맞지 않아요', exact: true }).waitFor();
  assert.equal(await page.locator('.event-table').count(), 0); assert.equal(oversizedReads, 1);
  oversizedProjectPage = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  stage = 'invalid-time-zone';
  await page.getByRole('heading', { name: '응답이 계약과 맞지 않아요', exact: true }).waitFor();
  assert.equal(pageErrors, 0);
  assert.equal(await page.locator('.event-table').count(), 0);
  stage = 'time-zone-recovery'; invalidProjectZone = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  stage = 'project-overview';
  await page.getByRole('button', { name: '통합 현황 불러오기', exact: true }).click();
  const overview = page.getByRole('table').filter({ hasText: '최근 수신(프로젝트 전체)' });
  await overview.locator('tbody tr').first().waitFor();
  assert.equal(await overview.locator('tbody tr').count(), 2);
  assert.ok((await overview.innerText()).includes('v2'));
  await page.screenshot({ path: resolve(directory, 'project-overview.png'), fullPage: true });
  await page.getByRole('button', { name: '통합 현황 닫기', exact: true }).click();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await page.getByRole('button', { name: '이벤트 분석', exact: true }).click();
  const csv = page.getByRole('button', { name: 'CSV 내려받기', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  trackingEventReads = true;
  stage = 'mismatched-event-time-zone';
  await page.getByRole('button', { name: 'tool_view', exact: true }).click();
  const detail = page.locator('.event-detail');
  await detail.getByRole('heading', { name: '응답이 계약과 맞지 않아요', exact: true }).waitFor();
  assert.equal(await detail.locator('.recharts-wrapper').count(), 0);
  assert.equal(await csv.isDisabled(), true);
  stage = 'event-time-zone-recovery'; mismatchedEventZone = false;
  await detail.getByRole('button', { name: '다시 시도', exact: true }).click();
  await detail.locator('.recharts-wrapper').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  const recoveryDownloadPromise = page.waitForEvent('download'); await csv.click();
  const recoveryDownload = await recoveryDownloadPromise;
  const recoveredCsv = await readFile(await recoveryDownload.path(), 'utf8');
  assert.ok(recoveredCsv.includes('"selected_event_total"'));
  assert.ok(recoveredCsv.includes('"Asia/Seoul"'));
  assert.equal(recoveredCsv.includes('"America/New_York"'), false);
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
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
  assert.equal(await page.getByRole('textbox', { name: '스키마 버전', exact: true }).inputValue(), '2');
  const downloadPromise = page.waitForEvent('download'); await csv.click();
  const download = await downloadPromise; assert.ok(download.suggestedFilename().startsWith('tallyfin-access-other-'));
  const exported = await readFile(await download.path(), 'utf8');
  assert.equal(exported.split('\r\n', 1)[0], '\uFEFF' + CSV_COLUMNS.map(column => `"${column}"`).join(','));
  assert.ok(exported.includes('"access-other"')); assert.equal(exported.includes('"sembom"'), false);
  stage = 'restore'; await local.setRole('owner');
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  assert.equal(await page.getByRole('textbox', { name: '스키마 버전', exact: true }).inputValue(), '1');
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other');
  await page.getByRole('textbox', { name: '스키마 버전', exact: true }).fill('1');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'CSV 내려받기' && !button.disabled));
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other');
  assert.equal(await page.getByRole('textbox', { name: '스키마 버전', exact: true }).inputValue(), '1');
  await page.getByRole('checkbox', { name: '스키마 자동 선택', exact: true }).check();
  await page.waitForFunction(() => document.querySelector('[aria-label="스키마 버전"]')?.value === '2');
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
  stage = 'disconnect-csv'; assert.equal(await csv.count(), 0);
  stage = 'disconnect-tables'; assert.equal(await page.locator('.event-table').count(), 0);
  stage = 'route-errors'; assert.equal(routeError, false);
  stage = 'page-errors'; assert.equal(pageErrors, 0);
  stage = 'event-workflow-count'; assert.equal(eventWorkflowReads, 0);
  const report = { latestActiveSchemaSelected: true, projectVersionSelectionsIsolated: true, automaticVersionRestored: true, projectOverviewVerified: true, eventWorkflowReads, verified: true, browser: browser.version(), oversizedReads, oversizedResponseRecovery: true, invalidZoneReads, invalidZoneRecovery: true,
    mismatchedEventZoneReads, mismatchedEventZoneBlocked: true, eventTimeZoneRecovery: true, deniedReads, deniedSummaryCleared: true, deniedCsvDisabled: true,
    otherProjectExportIsolated: true, recovery: true, lateDeniedReadIgnored: true, heldReads, disconnectClears: true, routeError, pageErrors, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch (error) {
  const assertion = error?.name === 'AssertionError' ? { actual: typeof error.actual === 'number' || typeof error.actual === 'boolean' ? error.actual : null, expected: typeof error.expected === 'number' || typeof error.expected === 'boolean' ? error.expected : null, operator: error.operator } : null;
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, verified: false, assertion }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, assertion }));
} finally { clearTimeout(watchdog); held?.release.resolve(); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
