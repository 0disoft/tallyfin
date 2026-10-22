import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium, expect } from 'playwright/test';
import { localDate, parseBatch, prepareBatch } from '@tallyfin/core';
import { D1Store } from '@tallyfin/storage-d1';
import { adminLoginFixture } from './admin-login-fixture.mjs';
import { Provisioner } from '../provision/store.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const subject = 'synthetic-login-operator';
let local, server, browser, page, directory, watchdog, fault, stage = 'fixture', routeError = false, pageErrors = 0;
const scenarios = [], observed = [];
let workflowDailyUnavailable = true;
const tableCells = rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim()));
try {
  const { values } = parseArgs({ options: { channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel));
  if (values.help) {
    console.log('npm run verify:admin-goal-access -- [--channel chromium|chrome|msedge]\nFresh signed local identity/D1 only: workflow/funnel current and previous breakdown denial, recovery, CSV and late-response isolation.');
    process.exit(0);
  }
  watchdog = setTimeout(() => { fault?.release?.resolve(); void browser?.close(); }, 60000);
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  directory = await mkdtemp(resolve(root, '.tmp/admin-goal-access-'));
  local = await adminLoginFixture(directory, { profile: 'goals' });
  const provisioner = new Provisioner(local.db), store = new D1Store(local.db), now = Date.now(), today = localDate(now, 'Asia/Seoul');
  // Seed real aggregates through Core validation/D1 commit. Historical receive times are fixture-only.
  for (const projectId of ['sembom', 'access-other']) {
    const registry = await store.loadRegistry(projectId, 1); assert.ok(registry);
    for (const daysAgo of [0, 7]) {
      const receivedAt = now - daysAgo * 86400000, occurredAt = new Date(receivedAt).toISOString();
      for (const kind of ['workflow', 'funnel']) {
        const identity = crypto.randomUUID(), properties = { tool: daysAgo ? 'timer' : 'loan' };
        const attachment = kind === 'workflow' ? { attempt: { workflowId: 'calculation', attemptId: identity, startedAt: occurredAt } }
          : { funnel: { funnelId: 'calculation_funnel', runId: identity, startedAt: occurredAt } };
        const batch = parseBatch(JSON.stringify({ schemaVersion: 1, source: 'browser', events:
          ['input_start', 'calculation_success'].map(name => ({ eventId: crypto.randomUUID(), name, occurredAt, properties, ...attachment })) }));
        assert.deepEqual(await store.commit(await prepareBatch(batch, registry, receivedAt), registry), { accepted: 2, duplicates: 0 });
      }
    }
  }
  assert.equal(await local.db.prepare('SELECT SUM(count) AS n FROM event_daily_counts').first('n'), 16);
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
    const url = new URL(route.request().url()), active = fault && !fault.used && url.origin === origin && fault.matches(url) ? fault : null;
    try {
      if (workflowDailyUnavailable && url.pathname === '/v1/projects/sembom/workflows/calculation/daily')
        return await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_unavailable' } }) });
      if (!active) return await local.route(route);
      active.used = true;
      await provisioner.apply(await provisioner.plan('revoke', { projectId: 'sembom', issuer: local.issuer, subject }));
      const response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
      try {
        assert.equal(response.status(), 403);
        observed.push({ scenario: active.name, path: url.pathname, previous: url.searchParams.get('to') < today, status: 403 });
        active.received.resolve();
        if (active.release) await active.release.promise;
        await route.fulfill({ response });
      } finally { await response.dispose(); }
    } catch {
      if (!active?.release) routeError = true;
      await route.abort().catch(() => {});
    } finally { active?.finished.resolve(); }
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', () => pageErrors++);
  stage = 'login'; await page.goto(origin); await page.getByRole('button', { name: '관리자 로그인', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('sembom');
  stage = 'bulk-overview';
  let overviewRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/v1/overview') overviewRequests++; });
  const overview = page.locator('section[aria-labelledby="project-overview-heading"]');
  await page.getByRole('button', { name: '통합 현황 불러오기', exact: true }).click();
  await expect(overview.locator('tbody tr')).toHaveCount(2);
  assert.equal(overviewRequests, 1);
  await expect(overview).not.toContainText('조회하지 못했어요');
  await expect(overview).toContainText('현재 성공 1 / 시작 1 · 진행 중 0');
  await expect(overview).toContainText('직전 성공 1 / 시작 1 · 진행 중 0');
  await expect(overview).toContainText('집계 중 · 비교 보류');
  await expect(overview).toContainText('조회 기준(UTC):');
  await expect(overview).toContainText(`현재 ${localDate(now - 6 * 86400000, 'Asia/Seoul')} ~ ${today}`);
  await expect(overview).toContainText(`직전 ${localDate(now - 13 * 86400000, 'Asia/Seoul')} ~ ${localDate(now - 7 * 86400000, 'Asia/Seoul')}`);
  await page.clock.setFixedTime(new Date(Date.now() + 86400000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(overview.getByRole('status')).toContainText('조회 기준과 현재 기기 날짜가 달라졌어요');
  assert.equal(overviewRequests, 1);
  await page.clock.setFixedTime(new Date());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(overview.getByText('조회 기준과 현재 기기 날짜가 달라졌어요.', { exact: false })).toHaveCount(0);
  assert.equal(overviewRequests, 1);
  scenarios.push(stage);
  stage = 'schema-free-overview-diagnostics';
  await local.db.prepare("UPDATE project_schemas SET status='retired' WHERE project_id='access-other'").run();
  const rejectedAt = Date.now(), rejectionMinute = Math.floor(rejectedAt / 60000) * 60000;
  await local.db.prepare(`INSERT INTO ingest_minute_usage(project_id,minute_start,request_count,rejections_json) VALUES(?,?,1,?)
    ON CONFLICT(project_id,minute_start) DO UPDATE SET rejections_json=excluded.rejections_json`)
    .bind('access-other', rejectionMinute, JSON.stringify({ unknown_schema: { count: 3, lastRejectedAt: rejectedAt } })).run();
  await page.getByRole('button', { name: '통합 현황 새로고침', exact: true }).click();
  const retiredRow = overview.locator('tbody tr').filter({ hasText: 'Other access fixture' });
  await expect(retiredRow).toContainText('활성 스키마 없음');
  await expect(retiredRow.locator('td').nth(0)).not.toContainText('수신 기록 없음');
  await expect(retiredRow.locator('td').nth(1)).toContainText('비교 불가');
  await expect(retiredRow.locator('td').nth(3)).toHaveText('3');
  assert.equal(overviewRequests, 2); scenarios.push(stage);
  await local.db.prepare("UPDATE project_schemas SET status='active' WHERE project_id='access-other'").run();
  await page.getByRole('button', { name: '통합 현황 닫기', exact: true }).click();
  await page.getByRole('button', { name: '목표', exact: true }).click();
  const workflowCsv = page.getByRole('button', { name: '작업 흐름 CSV 내려받기', exact: true });
  const comparison = page.getByRole('checkbox', { name: '작업 흐름·퍼널 기간 비교', exact: true });
  const workflowGroup = page.getByRole('combobox', { name: '시작 시점 분류 기준', exact: true });
  const funnelSelect = page.getByRole('combobox', { name: '퍼널 선택', exact: true });
  const funnelGroup = page.getByRole('combobox', { name: '퍼널 분류 기준', exact: true });
  const funnelCsv = page.getByRole('button', { name: '퍼널 CSV 내려받기', exact: true });
  const ready = async () => { await page.getByRole('heading', { name: '계산 완료', exact: true }).waitFor(); await expect(workflowCsv).toBeEnabled(); };
  const restore = async () => {
    stage = `restore:${stage}`;
    fault = null;
    await provisioner.apply(await provisioner.plan('grant', { projectId: 'sembom', issuer: local.issuer, subject, role: 'owner' }));
    await page.getByRole('button', { name: '새로고침', exact: true }).click(); await ready();
    if (await comparison.isChecked()) await comparison.uncheck();
  };
  const selectedFunnel = async () => { await funnelSelect.selectOption('calculation_funnel'); await expect(funnelCsv).toBeEnabled(); };
  const blocked = async () => {
    await page.getByRole('heading', { name: '이 프로젝트를 볼 권한이 없어요', exact: true }).waitFor();
    await expect(page.locator('.event-table')).toHaveCount(0);
    await expect(page.locator('.goal-section, .funnel-section')).toHaveCount(0);
    assert.equal(await funnelCsv.count(), 0);
    for (const button of await page.getByRole('button', { name: /CSV 내려받기/ }).all()) await expect(button).toBeDisabled();
  };
  const arm = (name, family, kind, prior, hold = false) => {
    stage = name;
    fault = { name, used: false, received: deferred(), finished: deferred(), ...(hold ? { release: deferred() } : {}),
      matches: url => url.pathname === `/v1/projects/sembom/${family}/${family === 'workflows' ? 'calculation' : 'calculation_funnel'}/${kind}`
        && (url.searchParams.get('to') < today) === prior };
    return fault;
  };
  stage = 'workflow-panel-failure';
  await page.getByRole('button', { name: '계산 완료 다시 시도', exact: true }).waitFor();
  await expect(workflowCsv).toBeDisabled();
  await selectedFunnel(); await expect(funnelCsv).toBeEnabled();
  workflowDailyUnavailable = false;
  await page.getByRole('button', { name: '계산 완료 다시 시도', exact: true }).click();
  await ready(); await expect(funnelCsv).toBeEnabled(); scenarios.push('workflow-panel-failure-recovery');
  arm('workflow-current-breakdown', 'workflows', 'breakdown', false);
  await workflowGroup.selectOption('tool'); await blocked(); scenarios.push(stage);

  await restore(); await workflowGroup.selectOption('tool');
  await page.locator('.workflow-property-analysis .event-table tbody tr').waitFor();
  await page.screenshot({ path: resolve(directory, 'workflow-ready.png'), fullPage: true });
  arm('workflow-previous-breakdown', 'workflows', 'breakdown', true);
  await comparison.check(); await blocked(); scenarios.push(stage);

  await restore(); arm('funnel-current-daily', 'funnels', 'daily', false);
  await funnelSelect.selectOption('calculation_funnel'); await blocked(); scenarios.push(stage);

  await restore(); await selectedFunnel(); arm('funnel-current-breakdown', 'funnels', 'breakdown', false);
  await funnelGroup.selectOption('tool'); await blocked(); scenarios.push(stage);

  await restore(); await selectedFunnel(); arm('funnel-previous-daily', 'funnels', 'daily', true);
  await comparison.check(); await blocked(); scenarios.push(stage);

  await restore(); await selectedFunnel(); await funnelGroup.selectOption('tool'); await expect(funnelCsv).toBeEnabled();
  arm('funnel-previous-breakdown', 'funnels', 'breakdown', true);
  await comparison.check(); await blocked(); scenarios.push(stage);

  await restore(); await selectedFunnel(); await funnelGroup.selectOption('tool'); await expect(funnelCsv).toBeEnabled();
  await comparison.check(); await expect(funnelCsv).toBeEnabled();
  await page.getByRole('heading', { name: '퍼널 직전 기간 비교', exact: true }).waitFor();
  assert.deepEqual(await page.locator('[aria-label="속성별 퍼널 직전 기간 비교 표"] tbody tr').evaluateAll(tableCells),
    [['loan', '1', '0', '100.0%', '—', '—'], ['timer', '0', '1', '—', '100.0%', '—']]);
  await page.screenshot({ path: resolve(directory, 'funnel-comparison-ready.png'), fullPage: true });
  let pendingDownload = page.waitForEvent('download'); await funnelCsv.click();
  let downloaded = await pendingDownload, contents = await readFile(await downloaded.path(), 'utf8');
  assert.ok(contents.includes('"sembom"')); assert.ok(contents.includes('"loan"')); assert.ok(contents.includes('"timer"'));
  // This finite fixture uses fully quoted, single-line cells, including numeric values.
  const lines = contents.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  const cells = line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"'));
  const columns = cells(lines.shift()), records = lines.map(line => {
    const values = cells(line); assert.equal(values.length, columns.length);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
  const summaries = records.filter(row => row.row_type === 'summary' && row.step_index === '0');
  assert.deepEqual(summaries.map(row => [row.period, row.started_runs, row.completed_runs, row.completion_rate_percent]),
    [['current', '1', '1', '100'], ['previous', '1', '1', '100']]);
  assert.deepEqual(records.filter(row => row.row_type === 'property_comparison' && row.metric === 'started')
    .map(row => [row.property_value, row.current_value, row.previous_value]), [['loan', '1', '0'], ['timer', '0', '1']]);
  const csvCounts = { workflow: (await local.db.prepare('SELECT SUM(started_count) AS n FROM workflow_daily_counts').first('n')),
    funnel: (await local.db.prepare('SELECT SUM(reached_count) AS n FROM funnel_daily_counts WHERE step_index = 0').first('n')) };
  assert.deepEqual(csvCounts, { workflow: 4, funnel: 4 });
  await comparison.uncheck(); await funnelGroup.selectOption(''); await expect(funnelCsv).toBeEnabled();
  const late = arm('late-funnel-denial', 'funnels', 'breakdown', false, true);
  await funnelGroup.selectOption('tool');
  await expect.poll(() => observed.some(row => row.scenario === late.name)).toBe(true);
  await page.getByRole('combobox', { name: '프로젝트 선택', exact: true }).selectOption('access-other'); await ready();
  late.release.resolve(); await late.finished.promise;
  await expect(workflowCsv).toBeEnabled();
  await expect(page.getByRole('heading', { name: '이 프로젝트를 볼 권한이 없어요', exact: true })).toHaveCount(0);
  pendingDownload = page.waitForEvent('download'); await workflowCsv.click();
  downloaded = await pendingDownload; contents = await readFile(await downloaded.path(), 'utf8');
  assert.ok(contents.includes('"access-other"')); assert.equal(contents.includes('"sembom"'), false); scenarios.push(stage);
  stage = 'bulk-overview-access-revocation';
  await page.getByRole('button', { name: '개요', exact: true }).click();
  await page.getByRole('heading', { name: '등록 이벤트 집계', exact: true }).waitFor();
  await provisioner.apply(await provisioner.plan('grant', { projectId: 'access-other', issuer: local.issuer,
    subject: 'synthetic-backup-operator', role: 'owner' }));
  await provisioner.apply(await provisioner.plan('revoke', { projectId: 'access-other', issuer: local.issuer, subject }));
  await page.getByRole('button', { name: '통합 현황 불러오기', exact: true }).click();
  await page.getByRole('heading', { name: '이 프로젝트를 볼 권한이 없어요', exact: true }).waitFor();
  await expect(overview.locator('tbody tr')).toHaveCount(2);
  await expect(overview).toContainText('조회하지 못했어요');
  for (const button of await page.getByRole('button', { name: /CSV 내려받기/ }).all()) await expect(button).toBeDisabled();
  assert.equal(overviewRequests, 3); scenarios.push(stage);
  stage = 'disconnect'; await page.getByRole('button', { name: '연결 끊기', exact: true }).click();
  await page.getByRole('button', { name: '관리자 로그인', exact: true }).waitFor();
  await expect(page.locator('.event-table, .goal-section, .funnel-section')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV 내려받기/ })).toHaveCount(0);
  assert.equal(routeError, false); assert.equal(pageErrors, 0); assert.equal(observed.length, 7);
  const report = { verified: true, browser: browser.version(), scenarios, observed, seededEvents: 16, csvCounts,
    displayedComparisonVerified: true, downloadedComparisonVerified: true,
    signedLocalIdentity: true, actualD1Revocation: true, staleTablesCleared: true, exportsBlocked: true,
    explicitRecovery: true, otherProjectExportIsolated: true, lateDenialIgnored: true, disconnectClears: true,
    routeError, pageErrors, ...local.counts };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ...report, directory }));
} catch (error) {
  if (directory) {
    await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ stage, verified: false, scenarios, observed }) + '\n');
    await page?.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1; console.error(JSON.stringify({ verified: false, stage, error: error.name }));
} finally { clearTimeout(watchdog); fault?.release?.resolve(); await browser?.close(); await server?.close(); await local?.mf.dispose(); }
