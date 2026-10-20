import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK } from 'jose';
import { mkdir, mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installation } from '../installation.ts';
import { checkInstallationProvider, runInstallCheckCli } from '../install-check.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function input(issuer = 'https://identity.example.invalid/tenant') {
  const accountId = crypto.randomUUID().replaceAll('-', '');
  return { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: `${issuer}/jwks` } },
    login: { issuer, clientId: 'public-test-client', scope: 'openid' } };
}
async function provider(config: ReturnType<typeof installation>, edits: Record<string, unknown> = {}, options: {
  cors?: string; keyEdits?: Record<string, unknown>; optionsStatus?: number; large?: boolean; streamingLarge?: boolean;
} = {}) {
  const { publicKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'test-public-key', alg: 'RS256', ...options.keyEdits };
  const issuer = config.registration.issuer;
  const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'], ...edits };
  const calls: { url: string; method: string; origin: string | null }[] = [];
  const fetchImpl: typeof fetch = async (target, init) => {
    const url = String(target), headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', origin: headers.get('Origin') });
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(init?.referrerPolicy, 'no-referrer'); assert.equal(headers.get('Authorization'), null);
    assert.equal(init?.body, undefined); assert.ok(init?.signal); assert.match(url, /^https:/);
    const cors = { 'Access-Control-Allow-Origin': options.cors ?? config.registration.browserOrigin };
    if (init?.method === 'OPTIONS') return new Response(null, { status: options.optionsStatus ?? 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST' } });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json(metadata, { headers: cors });
    if (options.large) return Response.json({ keys: [key] }, { headers: { ...cors, 'Content-Length': '65537' } });
    if (options.streamingLarge) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); controller.close(); } }), { headers: cors });
    return Response.json({ keys: [key] }, { headers: cors });
  };
  return { fetchImpl, calls };
}

test('public provider checks read bounded metadata/keys only and never claim login or infrastructure readiness', async () => {
  const plan = installation(input(), root), fixture = await provider(plan);
  const report = await checkInstallationProvider(plan, fixture.fetchImpl);
  assert.equal(report.publicChecksPassed, true); assert.equal(report.operationalReadinessVerified, false);
  assert.equal(report.tokensRequested, false); assert.equal(report.remoteChanges, false);
  assert.equal(report.checks.find(c => c.id === 'public-client-registration')?.status, 'unknown');
  assert.equal(fixture.calls[0]!.url, plan.registration.issuer + '/.well-known/openid-configuration');
  assert.deepEqual(fixture.calls.map(c => c.method), ['GET', 'GET', 'OPTIONS', 'GET']);
  assert.ok(!JSON.stringify(report).includes(plan.registration.issuer));
  assert.ok(!JSON.stringify(report).includes(plan.registration.clientId));
  const optional = await provider(plan, {}, { optionsStatus: 405 });
  const noOptions = await checkInstallationProvider(plan, optional.fetchImpl);
  assert.equal(noOptions.publicChecksPassed, true);
  assert.equal(noOptions.checks.find(c => c.id === 'token-cors-probe')?.status, 'unknown');
  const publisher = input();
  const publisherPlan = installation({ ...publisher, collector: { ...publisher.collector, settings: {
    ...publisher.collector.settings, PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: 'https://machine.example.invalid',
    PUBLISHER_OIDC_AUDIENCE: 'machine-api', PUBLISHER_OIDC_JWKS_URI: 'https://machine.example.invalid/jwks' } } }, root);
  const machine = await provider(publisherPlan);
  assert.equal((await checkInstallationProvider(publisherPlan, machine.fetchImpl)).checks.find(c => c.id === 'collector-publisher-public-keys')?.status, 'pass');
  assert.ok(machine.calls.some(call => call.url === 'https://machine.example.invalid/jwks' && call.origin === null));
});

test('issuer, algorithm, PKCE, HTTPS endpoints and actual cross-origin GET headers are required', async () => {
  const plan = installation(input(), root);
  for (const edits of [{ issuer: 'https://other.example.invalid' }, { token_endpoint: 'http://identity.example.invalid/token' },
    { token_endpoint: 'https://user:password@identity.example.invalid/token' },
    { code_challenge_methods_supported: [] }, { code_challenge_methods_supported: 'S256' },
    { response_types_supported: ['token'] }, { id_token_signing_alg_values_supported: ['ES256'] },
    { grant_types_supported: ['client_credentials'] }]) {
    const fixture = await provider(plan, edits); const report = await checkInstallationProvider(plan, fixture.fetchImpl);
    assert.equal(report.publicChecksPassed, false);
    assert.ok(fixture.calls.every(c => !c.url.startsWith('http:') && !c.url.includes('@')));
  }
  for (const cors of ['', 'https://other.example.invalid', '*, https://test-admin.fixture.workers.dev']) {
    const fixture = await provider(plan, {}, { cors }); assert.equal((await checkInstallationProvider(plan, fixture.fetchImpl)).publicChecksPassed, false);
  }
  const same = installation(input('https://test-admin.fixture.workers.dev'), root), fixture = await provider(same, {}, { cors: '' });
  assert.equal((await checkInstallationProvider(same, fixture.fetchImpl)).publicChecksPassed, true);
  assert.ok(fixture.calls.every(call => call.origin === null && call.method === 'GET'));
});

test('private, wrong-use or oversized key sets fail without leaking response bodies; caller cancellation stops reads', async () => {
  const plan = installation(input(), root);
  for (const options of [{ keyEdits: { d: 'rejected-private-field' } }, { keyEdits: { alg: 'ES256' } },
    { keyEdits: { use: 'enc' } }, { keyEdits: { key_ops: ['sign'] } }, { keyEdits: { kid: '' } }, { keyEdits: { n: 'AQAB' } },
    { large: true }, { streamingLarge: true }]) {
    const fixture = await provider(plan, {}, options); const report = await checkInstallationProvider(plan, fixture.fetchImpl);
    assert.equal(report.publicChecksPassed, false); assert.ok(!JSON.stringify(report).includes('rejected-private-field'));
  }
  const controller = new AbortController(); controller.abort(); let requests = 0;
  await assert.rejects(checkInstallationProvider(plan, async () => { requests++; throw Error(); }, controller.signal));
  // Aborted work must stop before contacting any provider.
  assert.equal(requests, 0);
  const stalled = new AbortController(); let cancelled = false;
  const waiting = checkInstallationProvider(plan, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { 'Content-Type': 'application/json' } }), stalled.signal);
  const timer = setTimeout(() => stalled.abort(), 10);
  try { await assert.rejects(waiting); assert.equal(cancelled, true); } finally { clearTimeout(timer); }
});

test('provider cancellation does not await ignored transport aborts or unfinished body cleanup', { timeout: 1000 }, async () => {
  const plan = installation(input(), root);
  for (const transport of [
    () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 503 }),
    async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })),
  ]) {
    const abort = new AbortController();
    const pending = checkInstallationProvider(plan, transport, abort.signal);
    const timer = setTimeout(() => abort.abort(), 10);
    try {
      const result = await pending.then(report => report, error => error);
      assert.ok(result instanceof Error || result.publicChecksPassed === false);
    } finally { clearTimeout(timer); }
  }
});

test('CLI revalidates prepared files before network activity and rejects extra remote/target options', async () => {
  const parent = join(root, '.tmp/install-check-tests'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'run-')), config = input(), plan = installation(config, root, directory);
  const artifacts = [['installation.json', plan.manifest], ['admin.wrangler.json', plan.admin], ['collector.wrangler.json', plan.collector],
    ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration]] as const;
  try {
    for (const [name, value] of artifacts) await writeFile(join(directory, name), JSON.stringify(value));
    const before = await Promise.all(artifacts.map(([name]) => readFile(join(directory, name), 'utf8')));
    const fixture = await provider(plan), lines: string[] = [];
    assert.equal(await runInstallCheckCli(['--dir', directory], line => lines.push(line), fixture.fetchImpl), true);
    assert.equal(JSON.parse(lines[0]!).operationalReadinessVerified, false);
    assert.deepEqual(await Promise.all(artifacts.map(([name]) => readFile(join(directory, name), 'utf8'))), before);
    let requests = 0; const neverFetch: typeof fetch = async () => { requests++; throw Error('must-not-fetch'); };
    for (const args of [[], ['--remote'], ['--dir', directory, '--url', 'https://other.example.invalid'], ['--dir', directory, '--dir', directory]])
      await assert.rejects(runInstallCheckCli(args, () => {}, neverFetch));
    await writeFile(join(directory, 'admin-login.json'), '{}');
    await assert.rejects(runInstallCheckCli(['--dir', directory], () => {}, neverFetch));
    assert.equal(requests, 0);
    assert.equal(await runInstallCheckCli(['--help'], () => {}, neverFetch), true);
  } finally {
    for (const [name] of artifacts) await unlink(join(directory, name)); await rmdir(directory);
  }
});
