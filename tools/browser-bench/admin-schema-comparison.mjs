import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { Provisioner } from '../provision/store.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const waitForHeld = async promise => {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('held_response_timeout')), 15000); })]); }
  finally { clearTimeout(timer); }
};
let local, server, browser, page, directory, watchdog, fault, held, stage = 'fixture';
let routeError = false, pageErrors = 0;
const scenarios = [];
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) console.log('npm run verify:admin-schema-comparison -- [--channel chromium|chrome|msedge]\nLocal signed OIDC/D1: published definitions, paging, drafts, reader access, errors and cancellation.');
  else {
    watchdog = setTimeout(() => { held?.release.resolve(); void browser?.close(); }, 90000);
    await mkdir(resolve(root, '.tmp'), { recursive: true });
    directory = await mkdtemp(resolve(root, '.tmp/admin-schema-comparison-'));
    local = await adminLoginFixture(directory, { profile: 'goals' });
    const provisioner = new Provisioner(local.db);
    const original = JSON.parse(await readFile(new URL('../../api/examples/registry.json', import.meta.url), 'utf8'));
    original.representativeWorkflowId = 'calculation';
    original.funnels = [{ id: 'calculation_funnel', label: '계산 퍼널', steps: ['input_start', 'calculation_success'].map(eventName => ({ eventName, source: 'browser' })), dimensions: ['tool'] }];
    for (let version = 2; version <= 27; version++) {
      const registry = structuredClone(original); registry.schemaVersion = version;
      if (version >= 26) {
        registry.events.find(event => event.name === 'result_copy').source = 'server';
        registry.events.find(event => event.name === 'validation_error').properties.error.values.push('unsupported');
        registry.workflows[0].failureEvent = 'validation_error'; registry.workflows[0].failureReasonProperty = 'error';
        registry.funnels[0].steps.splice(1, 0, { eventName: 'tool_view', source: 'browser' });
        delete registry.representativeWorkflowId;
      }
      await provisioner.apply(await provisioner.plan('register', registry));
    }
    original.schemaStatus = 'retired'; await provisioner.apply(await provisioner.plan('register', original));
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
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), active = fault && url.pathname === '/v1/projects/sembom/schemas/1' ? fault : null;
      if (active) fault = null;
      try {
        if (active === 'unavailable') return await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_unavailable' } }) });
        if (active === 'denied') {
          await provisioner.apply(await provisioner.plan('revoke', { projectId: 'sembom', issuer: local.issuer, subject: 'synthetic-login-operator' }));
        }
        if (active === 'held') {
          const holding = held, response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
          try { assert.equal(response.status(), 200); holding.received.resolve(); await holding.release.promise; await route.fulfill({ response }); }
          finally { await response.dispose(); holding.finished.resolve(); }
          return;
        }
        await local.route(route);
      } catch {
        if (active !== 'held') routeError = true;
        await route.abort().catch(() => {});
      }
    });
    page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', () => pageErrors++);
    stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
    await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
    const project = page.getByRole('combobox', { name: '프로젝트 선택', exact: true });
    await project.selectOption('sembom'); await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('tab', { name: '이벤트 스키마', exact: true }).click();
    await page.getByText('발행 버전', { exact: true }).click();
    const comparison = page.getByRole('region', { name: '버전 간 정의 비교', exact: true });
    const from = comparison.getByRole('combobox', { name: '기준 버전', exact: true }), to = comparison.getByRole('combobox', { name: '비교 버전', exact: true });
    const compare = () => comparison.getByRole('button', { name: /^(정의 비교|다시 비교)$/ });
    const rows = comparison.locator('tbody tr');
    stage = 'pagination-retired'; await expect(page.locator('#schema-tab-versions')).toHaveAttribute('aria-selected', 'true');
    await expect(from.locator('option[value="1"]')).toHaveCount(0);
    await page.getByRole('button', { name: '이전 버전 더 보기', exact: true }).click();
    await page.locator('#schema-tab-comparison').click();
    await expect(from.locator('option[value="1"]')).toHaveText('v1 · 사용 중지'); scenarios.push(stage);
    stage = 'draft-preserved';
    await page.locator('#schema-tab-editor').click();
    await page.getByText('JSON 직접 편집', { exact: true }).click();
    const draft = page.locator('#schema-draft'), target = page.locator('#schema-version');
    const text = (await draft.inputValue()) + '\n'; await draft.fill(text); await target.fill('99');
    await page.getByRole('button', { name: '정의 검증', exact: true }).click();
    const privacy = page.locator('.schema-privacy input');
    await expect(privacy).toBeEnabled(); await privacy.check();
    const writesBeforeComparison = local.counts.apiWrites;
    await page.locator('#schema-tab-comparison').click();
    await from.selectOption('1'); await to.selectOption('27'); await compare().click();
    await expect(rows).toHaveCount(6);
    await expect(comparison).toContainText('result_copy'); await expect(comparison).toContainText('validation_error.error');
    await expect(comparison).toContainText('실패 원인 속성'); await expect(comparison).toContainText('단계 (순서 포함)');
    await expect(draft).toHaveValue(text); await expect(target).toHaveValue('99'); await expect(privacy).toBeChecked();
    await page.locator('#schema-tab-editor').click();
    await expect(page.getByRole('button', { name: '새 버전 발행 (v99)', exact: true })).toBeEnabled();
    await page.locator('#schema-tab-comparison').click(); scenarios.push(stage);
    await comparison.screenshot({ path: resolve(directory, 'comparison-desktop.png') });
    stage = 'reverse-and-same';
    await from.selectOption('27'); await to.selectOption('1'); await compare().click();
    await expect(rows).toHaveCount(6); await expect(comparison).toContainText('v27 → v1');
    await to.selectOption('27'); await expect(compare()).toBeDisabled(); await expect(rows).toHaveCount(0); scenarios.push(stage);
    stage = 'equal-definitions'; await from.selectOption('26'); await compare().click();
    await expect(comparison).toContainText('정의 차이가 없어요.'); await expect(rows).toHaveCount(0); scenarios.push(stage);
    stage = 'error-and-explicit-retry'; await from.selectOption('1'); fault = 'unavailable'; await compare().click();
    await expect(comparison.getByRole('alert')).toContainText('HTTP 503'); await expect(rows).toHaveCount(0);
    await compare().click(); await expect(rows).toHaveCount(6); scenarios.push(stage);
    stage = 'late-response-after-selection';
    held = { received: deferred(), release: deferred(), finished: deferred() }; fault = 'held'; await compare().click();
    await waitForHeld(held.received.promise); await expect(comparison).toContainText('두 버전의 정의를 불러오는 중이에요.');
    await expect(rows).toHaveCount(0); await from.selectOption('26'); await compare().click();
    await expect(comparison).toContainText('정의 차이가 없어요.'); held.release.resolve(); await waitForHeld(held.finished.promise);
    await expect(comparison).toContainText('v26 → v27'); await expect(rows).toHaveCount(0); scenarios.push(stage);
    stage = 'project-change';
    held = { received: deferred(), release: deferred(), finished: deferred() }; fault = 'held';
    await from.selectOption('1'); await compare().click(); await waitForHeld(held.received.promise);
    page.once('dialog', dialog => dialog.accept()); await project.selectOption('access-other');
    await page.getByRole('tab', { name: '이벤트 스키마', exact: true }).click();
    await page.getByText('버전 비교', { exact: true }).click();
    await expect(comparison).toContainText('발행된 버전이 두 개 이상이면 비교할 수 있어요.');
    held.release.resolve(); await waitForHeld(held.finished.promise); await expect(rows).toHaveCount(0); scenarios.push(stage);
    stage = 'reader-access';
    // The goals fixture has a backup owner, so downgrading this test identity is safe.
    await provisioner.apply(await provisioner.plan('grant', { projectId: 'sembom', issuer: local.issuer, subject: 'synthetic-login-operator', role: 'reader' }));
    await project.selectOption('sembom');
    await page.getByRole('tab', { name: '이벤트 스키마', exact: true }).click();
    await page.getByText('버전 비교', { exact: true }).click();
    await page.getByText('발행 버전', { exact: true }).click();
    await page.getByRole('button', { name: '이전 버전 더 보기', exact: true }).click();
    await page.locator('#schema-tab-comparison').click();
    await from.selectOption('1'); await to.selectOption('27'); await compare().click();
    await expect(rows).toHaveCount(6); await expect(target).toBeDisabled(); scenarios.push(stage);
    stage = 'mobile'; await page.setViewportSize({ width: 390, height: 844 });
    await comparison.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await comparison.screenshot({ path: resolve(directory, 'comparison-mobile.png') }); scenarios.push(stage);
    stage = 'access-revoked'; fault = 'denied'; await compare().click();
    await expect(page.getByText('이 프로젝트에 대한 권한이 없어요. (HTTP 403)', { exact: true }).first()).toBeVisible();
    await expect(rows).toHaveCount(0); scenarios.push(stage);
    assert.equal(local.counts.apiWrites, writesBeforeComparison); assert.equal(routeError, false); assert.equal(pageErrors, 0);
    const report = { verified: true, browser: browser.version(), scenarios, pageErrors, routeError,
      comparisonWrites: local.counts.apiWrites - writesBeforeComparison, ...local.counts, directory };
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  }
} catch (error) {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, code: 'admin_schema_comparison_failed', message: error.message }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, code: 'admin_schema_comparison_failed', message: error.message, directory }));
} finally {
  clearTimeout(watchdog); held?.release.resolve();
  await browser?.close(); await server?.close(); await local?.mf.dispose();
}
