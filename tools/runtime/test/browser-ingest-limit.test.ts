import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare } from 'miniflare';
import { deploymentTarget } from '../target.ts';
import { browserIngestLimit } from '../browser-ingest-limit.ts';
import { writeInstallation } from '../write-installation.ts';
import { preparedInstallation } from '../prepared-installation.ts';

const root = process.cwd();
const limit = { namespaceId: '1001', limit: 120, period: 60 };
function input() {
  const accountId = crypto.randomUUID().replaceAll('-', '');
  return { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid',
        OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' } },
    login: { issuer: 'https://identity.example.invalid', clientId: 'public-test-client', scope: 'openid' } };
}

test('optional limiter preserves legacy targets and emits an explicit binding and required flag', () => {
  const legacy = deploymentTarget(input().collector, root);
  assert.equal(Object.hasOwn(legacy, 'ratelimits'), false);
  assert.equal(Object.hasOwn(legacy.vars, 'BROWSER_INGEST_LIMITER_REQUIRED'), false);
  for (const period of [10, 60]) {
    const target = deploymentTarget({ ...input().collector, browserIngestLimit: { ...limit, period } }, root);
    assert.deepEqual(target.ratelimits, [{ name: 'BROWSER_INGEST_LIMITER', namespace_id: limit.namespaceId,
      simple: { limit: limit.limit, period } }]);
    assert.equal(target.vars.BROWSER_INGEST_LIMITER_REQUIRED, 'true');
  }
  for (const bad of [null, {}, { ...limit, secret: 'rejected' }, ...['', '0', '01', '-1', '1e3', ' 1', '1\n',
    '9007199254740992'].map(namespaceId => ({ ...limit, namespaceId })), { ...limit, namespaceId: 1001 },
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '120'].map(value => ({ ...limit, limit: value })),
    ...[1, 30, 61, '60'].map(period => ({ ...limit, period }))]) {
    assert.throws(() => browserIngestLimit(bad));
    assert.throws(() => deploymentTarget({ ...input().collector, browserIngestLimit: bad }, root));
  }
});

test('prepared bundles round-trip admission configuration and reject stripped or changed protection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-ingress-'));
  try {
    const configuration = input();
    const supplied = { ...configuration, collector: { ...configuration.collector, browserIngestLimit: limit } };
    const output = join(directory, 'prepared');
    await writeInstallation(supplied, root, output);
    const plan = await preparedInstallation(output, root);
    assert.equal(plan.collector.vars.BROWSER_INGEST_LIMITER_REQUIRED, 'true');
    assert.equal(plan.collector.ratelimits![0]!.namespace_id, limit.namespaceId);
    const file = join(output, 'collector.wrangler.json'), original = await readFile(file, 'utf8');
    for (const edit of [(value: typeof plan.collector) => { delete value.ratelimits; },
      (value: typeof plan.collector) => { value.ratelimits![0]!.simple.limit++; },
      (value: typeof plan.collector) => { value.ratelimits![0]!.namespace_id = '1002'; },
      (value: typeof plan.collector) => { delete value.vars.BROWSER_INGEST_LIMITER_REQUIRED; }]) {
      const altered = JSON.parse(original); edit(altered);
      await writeFile(file, JSON.stringify(altered));
      await assert.rejects(preparedInstallation(output, root), /Invalid prepared installation/);
    }
    await writeFile(file, original);
    assert.equal((await preparedInstallation(output, root)).collector.ratelimits!.length, 1);
    const legacy = join(directory, 'legacy');
    await writeInstallation(configuration, root, legacy);
    assert.equal((await preparedInstallation(legacy, root)).collector.ratelimits, undefined);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('generated rate-limit definition is accepted by the installed native Worker runtime', async () => {
  const target = deploymentTarget({ ...input().collector, browserIngestLimit: limit }, root);
  const { name, ...definition } = target.ratelimits![0]!;
  const mf = new Miniflare({ modules: true, compatibilityDate: target.compatibility_date,
    ratelimits: { [name]: definition }, script: `export default { async fetch(request, env) {
      return Response.json(await env.BROWSER_INGEST_LIMITER.limit({ key: 'tallyfin-browser:fixture' }));
    } }` });
  try {
    const response = await mf.dispatchFetch('https://collector.example.invalid/');
    assert.deepEqual(await response.json(), { success: true });
  } finally { await mf.dispose(); }
});
