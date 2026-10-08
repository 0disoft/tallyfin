import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fixture } from './fixture.ts';

const { values } = parseArgs({ options: { samples: { type: 'string', default: '5' },
  channel: { type: 'string', default: 'chromium' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('npm run bench:browser -- [--samples 2..20] [--channel chromium|chrome|msedge]');
} else {
  const samples = Number(values.samples);
  assert.ok(Number.isInteger(samples) && samples >= 2 && samples <= 20, 'Use 2..20 samples');
  assert.ok(['chromium', 'chrome', 'msedge'].includes(values.channel), 'Use a supported browser channel');
  let local; let browser;
  const abort = new AbortController();
  const stop = () => { abort.abort(); void browser?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    browser = await chromium.launch({ channel: values.channel, headless: true });
    local = await fixture();
    const rows = []; const errors = [];
    async function measure(mode, round) {
      abort.signal.throwIfAborted();
      const requestOffset = local.requests.length;
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      try {
        // Benchmarks never visit a remote URL or use an authenticated browser profile.
        await context.route('**/*', route => new URL(route.request().url()).origin === local.origin ? route.continue() : route.abort());
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${local.origin}/?mode=${mode}`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__bench?.ready);
        // Real browser actions; timing is recorded inside the handler, excluding automation latency.
        for (let i = 0; i < 10; i++) {
          await page.locator('#left').fill(String(i + 1));
          await page.locator('#right').fill('2');
          await page.locator('#calculate').click();
          assert.equal(await page.locator('#result').textContent(), String(i + 3));
        }
        await page.locator('#left').fill('');
        await page.locator('#calculate').click();
        assert.equal(await page.locator('#result').textContent(), 'Enter both numbers');
        await page.locator('#left').fill('40');
        await page.locator('#calculate').click();
        assert.equal(await page.locator('#result').textContent(), '42');
        const beforeFlush = local.requests.length;
        await page.evaluate(() => window.__bench.flush());
        if (mode === 'enabled') await page.waitForFunction(() => window.__bench.pending === 0);
        if (mode === 'outage') {
          await page.waitForTimeout(3300); // Observe both bounded retries before destroy.
          assert.ok(local.requests.slice(beforeFlush).some(request => request.status === 503));
        }
        await page.waitForTimeout(80); // Allow frame/PerformanceObserver callbacks to finish.
        const row = await page.evaluate(() => window.__bench.snapshot());
        assert.equal(row.calculations, 11);
        assert.equal(row.accepted, mode === 'disabled' ? 0 : 24);
        if (mode === 'disabled') assert.deepEqual(row.sdkResource, []);
        else assert.equal(row.sdkResource.length, 1);
        await page.evaluate(() => window.__bench.destroy());
        const afterDestroy = local.requests.length;
        await page.waitForTimeout(mode === 'outage' ? 2300 : 20);
        assert.equal(local.requests.length, afterDestroy, 'destroy left a retry running');
        const transport = local.requests.slice(requestOffset);
        if (mode === 'disabled') assert.deepEqual(transport, []);
        if (mode === 'enabled') assert.ok(transport.length && transport.every(request => request.status === 200));
        rows.push({ mode, round, ...row, transport: { requests: transport.length,
          bodyBytes: transport.reduce((sum, request) => sum + request.bodyBytes, 0),
          statuses: transport.map(request => request.status) } });
      } finally { await context.close(); }
    }
    for (let i = 0; i < samples; i++) {
      for (const mode of i % 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled']) await measure(mode, i + 1);
    }
    const stored = await local.snapshot();
    const counts = Object.fromEntries(stored.events.map(row => [row.event_name, row.count]));
    assert.deepEqual(counts, { calculation_success: 11 * samples, input_start: 11 * samples,
      tool_view: samples, validation_error: samples });
    assert.deepEqual(stored.workflows, [{ started: 11 * samples, succeeded: 11 * samples }]);
    await local.stopCollector(); // Actual collector stopped; the calculation page remains live.
    await measure('outage', 1);
    assert.deepEqual(errors, [], 'Browser script errors');
    assert.ok(local.requests.every(request => request.bodyBytes <= 16384 && request.originPresent &&
      !request.credentialsPresent && !request.referrerPresent));
    function distribution(values) {
      const sorted = values.filter(value => typeof value === 'number').sort((a, b) => a - b);
      if (!sorted.length) return null;
      const at = percentile => sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
      return { n: sorted.length, p50: at(.5), p95: at(.95), max: sorted.at(-1) };
    }
    const summary = Object.fromEntries(['disabled', 'enabled', 'outage'].map(mode => {
      const runs = rows.filter(row => row.mode === mode);
      return [mode, Object.fromEntries(['sdkImportMs', 'sdkInitMs', 'sdkCallsMs', 'handlersMs', 'handlerToSecondFrameMs', 'fcpMs']
        .map(key => [key, distribution(runs.flatMap(row => row[key]))]))];
    }));
    const report = { measuredAt: new Date().toISOString(), channel: values.channel, browserVersion: browser.version(),
      nodeVersion: process.version, platform: process.platform, samples, headless: true, viewport: { width: 1280, height: 800 },
      conditions: 'Local synthetic page, fresh contexts, no-store assets, alternating disabled/enabled order, no CPU/network throttling. Frame timing is not INP; import timing includes fetching/linking/evaluation.',
      sdkBytes: local.sdkBytes, sdkGzipBytes: local.sdkGzipBytes, summary, stored, requests: local.requests, rows };
    const output = new URL(`../../.tmp/browser-bench/${Date.now()}.json`, import.meta.url);
    await mkdir(new URL('./', output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: fileURLToPath(output), sdkGzipBytes: report.sdkGzipBytes,
      verified: { dbCounts: counts, workflow: stored.workflows[0], calculationsDuringOutage: 11, credentialAndReferrerFree: true }, summary }, null, 2));
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { await browser?.close(); } finally { await local?.close(); }
  }
}
