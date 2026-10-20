import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { PassThrough, Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import adminWorker from '../../../apps/admin/worker/index.js';
import { checkInstallationAccess, readAccessToken, runInstallAccessCheckCli } from '../install-access-check.ts';
import { runAccessMonitorCli } from '../monitor-access.ts';
import { collectorHarness } from '../collector-harness.ts';
import { installation } from '../installation.ts';
import { initialize } from '../../provision/local.ts';
import { Provisioner } from '../../provision/store.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url)), parent = resolve(root, '.tmp/install-access-tests');
let directory: string, local: Awaited<ReturnType<typeof collectorHarness>>;
function input() {
  const accountId = crypto.randomUUID().replaceAll('-', '');
  return { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: local.principal.issuer, OIDC_AUDIENCE: 'benchmark-admin', OIDC_JWKS_URI: `${local.principal.issuer}/jwks` } },
    login: { issuer: local.principal.issuer, clientId: 'public-test-client', scope: 'openid' } };
}
before(async () => {
  await mkdir(parent, { recursive: true }); directory = await mkdtemp(join(parent, 'run-'));
  local = await collectorHarness(directory, Date.now());
  await initialize(await local.mf.getD1Database('DB'), true);
});
after(async () => {
  await local?.mf.dispose();
  if (directory) { assert.ok(resolve(directory).startsWith(parent + sep)); await rm(directory, { recursive: true, force: true }); }
});
function proxy(plan: ReturnType<typeof installation>) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.ok(new URL(String(url)).origin === plan.registration.browserOrigin);
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(init?.referrerPolicy, 'no-referrer'); assert.ok(init?.signal);
    assert.ok(new Headers(init?.headers).get('Authorization') === `Bearer ${local.adminToken}`);
    calls.push(new URL(String(url)).pathname + new URL(String(url)).search);
    return adminWorker.fetch(new Request(url, init), {
      COLLECTOR: { fetch: (request: Request) => local.mf.dispatchFetch(request.url, {
        method: request.method, headers: Object.fromEntries(request.headers), redirect: 'manual',
      }) },
      ASSETS: { fetch: () => { throw Error('unexpected-asset-read'); } },
    });
  };
  return { calls, fetchImpl };
}

test('real admin proxy, signed OIDC and local D1 verify three gated reads without exposing or changing identity/project data', async () => {
  const plan = installation(input(), root), transport = proxy(plan), db = await local.mf.getD1Database('DB');
  const empty = await checkInstallationAccess(plan, local.adminToken, transport.fetchImpl);
  assert.equal(empty.accessChecksPassed, true); assert.equal(empty.visibleProjectObserved, false);
  assert.deepEqual(transport.calls, ['/v1/identity', '/v1/health', '/v1/projects?limit=1']);
  assert.equal(empty.schemaVersion, 'tallyfin.install-access-check/v2');
  assert.deepEqual(empty.checks.map(check => [check.id, check.status]),
    [['admin-identity', 'pass'], ['admin-storage-read', 'pass'], ['project-list', 'pass']]);
  const registry = JSON.parse(await readFile(new URL('../../../api/examples/registry.json', import.meta.url), 'utf8'));
  const provisioner = new Provisioner(db);
  for (const id of ['sembom', 'second']) {
    await provisioner.apply(await provisioner.plan('register', { ...registry, project: { ...registry.project, id } }), local.now);
    await provisioner.apply(await provisioner.plan('grant', { projectId: id, ...local.principal, role: 'reader' }), local.now);
  }
  const snapshot = async () => Promise.all(['projects', 'project_grants', 'admin_changes', 'ingest_daily_usage']
    .map(table => db.prepare(`SELECT * FROM ${table}`).all().then(value => value.results)));
  const beforeRead = await snapshot(), visible = await checkInstallationAccess(plan, local.adminToken, transport.fetchImpl);
  assert.equal(visible.accessChecksPassed, true); assert.equal(visible.visibleProjectObserved, true);
  assert.equal(visible.operationalReadinessVerified, false); assert.equal(visible.remoteChanges, false); assert.equal(visible.tokensRequested, false);
  for (const privateValue of [local.adminToken, local.principal.issuer, local.principal.subject, plan.registration.browserOrigin, 'Sembom', 'sembom'])
    assert.ok(!JSON.stringify(visible).includes(privateValue));
  assert.deepEqual(await snapshot(), beforeRead);
  assert.equal(transport.calls.length, 6);
});

test('real issuer/audience rejection, mismatched identity and unknown responses stop before project enumeration', async () => {
  const plan = installation(input(), root); let calls = 0;
  const native: typeof fetch = async (url, init) => {
    calls++; return adminWorker.fetch(new Request(url, init), { COLLECTOR: { fetch: (request: Request) => local.mf.dispatchFetch(request.url, {
      method: request.method, headers: Object.fromEntries(request.headers), redirect: 'manual',
    }) } });
  };
  const unauthorized = await checkInstallationAccess(plan, local.publisherToken, native);
  assert.equal(unauthorized.accessChecksPassed, false); assert.equal(unauthorized.visibleProjectObserved, null);
  assert.equal(unauthorized.checks[0]?.code, 'administrator-authentication-rejected'); assert.equal(calls, 1);
  for (const response of [
    Response.json({ issuer: 'https://wrong.example.invalid', subject: 'unexpected-private-identity' }),
    Response.json({ issuer: local.principal.issuer, subject: local.principal.subject, token: local.adminToken }),
    new Response('private upstream error', { status: 503 }), new Response(null, { status: 302, headers: { Location: 'https://other.example.invalid' } }),
  ]) {
    calls = 0;
    const report = await checkInstallationAccess(plan, local.adminToken, async () => { calls++; return response; });
    assert.equal(report.accessChecksPassed, false); assert.equal(report.visibleProjectObserved, null); assert.equal(calls, 1);
    assert.equal(report.checks[1]?.code, 'identity-check-required');
    assert.equal(report.checks[2]?.code, 'identity-check-required');
    assert.ok(!JSON.stringify(report).includes('unexpected-private-identity')); assert.ok(!JSON.stringify(report).includes(local.adminToken));
  }
});

test('bounded JSON, closed single-row page and cancellation cannot yield a fabricated successful access check', async () => {
  const plan = installation(input(), root);
  const identities = [new Response('<html>private</html>'), Response.json({ issuer: local.principal.issuer, subject: local.principal.subject }, { headers: { 'Content-Length': '16385' } }),
    new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16385)); c.close(); } }), { headers: { 'Content-Type': 'application/json' } })];
  for (const response of identities)
    assert.equal((await checkInstallationAccess(plan, local.adminToken, async () => response)).checks[0]?.code, 'api-response-invalid');
  const valid = { id: 'example', name: 'Private project', status: 'active', timeZone: 'UTC' };
  for (const page of [
    { data: [valid], page: { limit: 25, nextCursor: null } }, { data: [valid, valid], page: { limit: 1, nextCursor: null } },
    { data: [], page: { limit: 1, nextCursor: 'example' } }, { data: [valid], page: { limit: 1, nextCursor: 'wrong' } },
    { data: [{ ...valid, token: local.adminToken }], page: { limit: 1, nextCursor: null } },
  ]) {
    let calls = 0;
    const report = await checkInstallationAccess(plan, local.adminToken, async () => Response.json(++calls === 1 ? local.principal :
      calls === 2 ? { status: 'ok', scope: 'administrator_storage_read' } : page));
    assert.equal(report.accessChecksPassed, false); assert.equal(report.visibleProjectObserved, null); assert.equal(calls, 3);
  }
  const pre = new AbortController(); pre.abort(); let requests = 0;
  await assert.rejects(checkInstallationAccess(plan, local.adminToken, async () => { requests++; throw Error(); }, pre.signal));
  assert.equal(requests, 0);
  const abort = new AbortController(); let canceled = false;
  const stalled = checkInstallationAccess(plan, local.adminToken, async () => new Response(new ReadableStream({ cancel() { canceled = true; } }),
    { headers: { 'Content-Type': 'application/json' } }), abort.signal);
  const timer = setTimeout(() => abort.abort(), 10);
  try { await assert.rejects(stalled); assert.equal(canceled, true); } finally { clearTimeout(timer); }
});

test('invalid or unavailable storage probes stop before project enumeration and preserve only fixed diagnostics', async () => {
  const plan = installation(input(), root);
  for (const health of [
    Response.json({ status: 'ok', scope: 'whole_service' }),
    Response.json({ status: 'ok', scope: 'administrator_storage_read', token: local.adminToken }),
    Response.json({ status: 'ready', scope: 'administrator_storage_read' }), Response.json({ status: 'ok' }),
    new Response('private-upstream-marker', { status: 503 }),
    new Response('private-upstream-marker', { status: 401 }), new Response(null, { status: 404 }),
  ]) {
    const calls: string[] = [];
    const report = await checkInstallationAccess(plan, local.adminToken, async url => {
      calls.push(new URL(String(url)).pathname);
      return calls.length === 1 ? Response.json(local.principal) : health;
    });
    assert.deepEqual(calls, ['/v1/identity', '/v1/health']);
    assert.equal(report.accessChecksPassed, false); assert.equal(report.visibleProjectObserved, null);
    assert.equal(report.checks[0]!.status, 'pass'); assert.notEqual(report.checks[1]!.status, 'pass');
    assert.deepEqual(report.checks[2], { id: 'project-list', status: 'unknown', code: 'storage-check-required' });
    const encoded = JSON.stringify(report);
    for (const sensitive of [local.adminToken, local.principal.subject, 'private-upstream-marker']) assert.ok(!encoded.includes(sensitive));
  }
});

test('real storage failure after successful authentication prevents project lookup through the admin proxy', async () => {
  const plan = installation(input(), root), transport = proxy(plan), db = await local.mf.getD1Database('DB');
  await db.prepare('ALTER TABLE project_grants RENAME TO unavailable_probe_grants').run();
  try {
    const report = await checkInstallationAccess(plan, local.adminToken, transport.fetchImpl);
    assert.deepEqual(transport.calls, ['/v1/identity', '/v1/health']);
    assert.equal(report.accessChecksPassed, false); assert.equal(report.visibleProjectObserved, null);
    assert.deepEqual(report.checks, [
      { id: 'admin-identity', status: 'pass', code: 'authenticated-read-verified' },
      { id: 'admin-storage-read', status: 'unknown', code: 'api-http-response-unverified' },
      { id: 'project-list', status: 'unknown', code: 'storage-check-required' },
    ]);
    assert.ok(!JSON.stringify(report).includes('unavailable_probe_grants'));
  } finally { await db.prepare('ALTER TABLE unavailable_probe_grants RENAME TO project_grants').run(); }
});

test('non-interactive bounded stdin rejects unsafe credentials and closes canceled or oversized reads', async () => {
  assert.ok(await readAccessToken(Readable.from([local.adminToken + '\r\n'])) === local.adminToken);
  for (const invalid of ['', local.adminToken + '\n\n', local.adminToken + ' other', 'a'.repeat(8193), Buffer.from([0xff])])
    await assert.rejects(readAccessToken(Readable.from([invalid])));
  await assert.rejects(readAccessToken(Object.assign(new PassThrough(), { isTTY: true })));
  const stream = new PassThrough(), abort = new AbortController();
  const pending = readAccessToken(stream, abort.signal); abort.abort(); await assert.rejects(pending); assert.equal(stream.destroyed, true);
  let requests = 0;
  for (const invalid of ['', local.adminToken + '\n'])
    await assert.rejects(checkInstallationAccess(installation(input(), root), invalid, async () => { requests++; throw Error(); }));
  assert.equal(requests, 0);
});

test('cancellation bounds ignored transport aborts and stalled response cleanup', { timeout: 2000 }, async () => {
  const plan = installation(input(), root);
  for (const transport of [
    () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 401 }),
    async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const abort = new AbortController();
    const pending = checkInstallationAccess(plan, local.adminToken, transport, abort.signal);
    const timer = setTimeout(() => abort.abort(), 10);
    try {
      const result = await pending.then(report => report, error => error);
      assert.ok(result instanceof Error || result.accessChecksPassed === false);
    } finally { clearTimeout(timer); }
  }
});

test('monitor CLI persists failure and recovery against signed OIDC, the real admin proxy and a broken/restored D1 table', async () => {
  const output = join(directory, 'monitor-installation'); await mkdir(output);
  const plan = installation(input(), root, output), statePath = join(output, 'monitor-state.json');
  const artifacts = [['installation.json', plan.manifest], ['admin.wrangler.json', plan.admin], ['collector.wrangler.json', plan.collector],
    ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration]] as const;
  for (const [name, value] of artifacts) await writeFile(join(output, name), JSON.stringify(value));
  const originals = await Promise.all(artifacts.map(([name]) => readFile(join(output, name), 'utf8')));
  const db = await local.mf.getD1Database('DB'), transport = proxy(plan); let tokens = 0, now = Date.now();
  const args = ['--dir', output, '--state', statePath, '--failure-threshold', '2', '--recovery-threshold', '2', '--max-gap-seconds', '60', '--token-stdin'];
  const options = { readToken: async () => { tokens++; return local.adminToken; }, fetchImpl: transport.fetchImpl, now: () => now += 1000 };
  const reports: Record<string, unknown>[] = [];
  const run = () => runAccessMonitorCli(args, line => { reports.push(JSON.parse(line)); }, options);
  assert.equal(await run(), 0);
  await db.prepare('ALTER TABLE project_grants RENAME TO monitor_unavailable_grants').run();
  try { assert.equal(await run(), 1); assert.equal(await run(), 1); assert.equal(await run(), 1); }
  finally { await db.prepare('ALTER TABLE monitor_unavailable_grants RENAME TO project_grants').run(); }
  assert.equal(await run(), 1); assert.equal(await run(), 0);
  assert.deepEqual(reports.map(report => report.event), ['healthy', 'failure_pending', 'incident_opened', 'incident_ongoing', 'recovery_pending', 'incident_resolved']);
  assert.deepEqual(reports.map(report => report.notify), [false, false, true, false, false, true]);
  assert.equal(transport.calls.length, 15); assert.equal(tokens, 6);
  for (const report of reports) { assert.equal(report.serviceHealth, 'unknown'); assert.equal(report.remoteChanges, false); assert.equal(report.notificationsSent, false); }
  const saved = await readFile(statePath, 'utf8'), serialized = JSON.stringify(reports) + saved;
  for (const privateValue of [local.adminToken, local.principal.issuer, local.principal.subject, plan.registration.browserOrigin, 'monitor_unavailable_grants'])
    assert.ok(!serialized.includes(privateValue));
  const differentPolicy = [...args]; differentPolicy[5] = '3';
  await assert.rejects(runAccessMonitorCli(differentPolicy, () => {}, options));
  assert.equal(tokens, 6); assert.equal(await readFile(statePath, 'utf8'), saved);
  await assert.rejects(runAccessMonitorCli(args, () => {}, { ...options, now: () => 0 })); assert.equal(tokens, 6);
  await writeFile(statePath, JSON.stringify({ ...JSON.parse(saved), targetFingerprint: '0'.repeat(64) }));
  await assert.rejects(run()); assert.equal(tokens, 6);
  await writeFile(statePath, '{'); await assert.rejects(run()); assert.equal(tokens, 6);
  await writeFile(statePath, saved);
  const canceledState = join(output, 'canceled-state.json'), cancelArgs = [...args]; cancelArgs[3] = canceledState;
  const abort = new AbortController(); let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  const pending = runAccessMonitorCli(cancelArgs, () => {}, { ...options, signal: abort.signal,
    readToken: () => { reading(); return new Promise(() => {}); } });
  await started; abort.abort(); await assert.rejects(pending);
  await assert.rejects(readFile(canceledState), { code: 'ENOENT' });
  await assert.rejects(readFile(canceledState + '.lock'), { code: 'ENOENT' });
  for (const invalid of [[], [...args, '--token-stdin'], [...args, '--token', 'private-marker']])
    await assert.rejects(runAccessMonitorCli(invalid, () => {}, options));
  assert.equal(await runAccessMonitorCli(['--help'], () => {}, options), 0); assert.equal(tokens, 6);
  assert.deepEqual(await Promise.all(artifacts.map(([name]) => readFile(join(output, name), 'utf8'))), originals);
});

test('CLI validates the unchanged installation before reading stdin and emits only redacted access facts', async () => {
  const output = join(directory, 'installation'); await mkdir(output);
  const plan = installation(input(), root, output);
  const artifacts = [['installation.json', plan.manifest], ['admin.wrangler.json', plan.admin], ['collector.wrangler.json', plan.collector],
    ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration]] as const;
  try {
    for (const [name, value] of artifacts) await writeFile(join(output, name), JSON.stringify(value));
    const beforeRead = await Promise.all(artifacts.map(([name]) => readFile(join(output, name), 'utf8')));
    const transport = proxy(plan), lines: string[] = []; let tokens = 0;
    const options = { readToken: async () => { tokens++; return local.adminToken; }, fetchImpl: transport.fetchImpl };
    assert.equal(await runInstallAccessCheckCli(['--dir', output, '--token-stdin'], line => lines.push(line), options), true);
    assert.equal(tokens, 1); assert.equal(JSON.parse(lines[0]!).accessChecksPassed, true);
    assert.ok(!lines[0]!.includes(local.adminToken)); assert.ok(!lines[0]!.includes(local.principal.subject));
    assert.deepEqual(await Promise.all(artifacts.map(([name]) => readFile(join(output, name), 'utf8'))), beforeRead);
    for (const args of [[], ['--dir', output], ['--remote', '--dir', output, '--token-stdin'], ['--dir', output, '--token', 'not-supported']])
      await assert.rejects(runInstallAccessCheckCli(args, () => {}, options));
    await writeFile(join(output, 'admin-login.json'), '{}');
    await assert.rejects(runInstallAccessCheckCli(['--dir', output, '--token-stdin'], () => {}, options));
    assert.equal(tokens, 1); assert.equal(transport.calls.length, 3);
    assert.equal(await runInstallAccessCheckCli(['--help'], () => {}, options), true); assert.equal(tokens, 1);
  } finally { for (const [name] of artifacts) await unlink(join(output, name)); await rmdir(output); }
});
