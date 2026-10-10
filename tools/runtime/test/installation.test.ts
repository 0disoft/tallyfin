import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installation } from '../installation.ts';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Syntax-only fixtures. No account, provider, domain or token is created or contacted.
function input() {
  const accountId = crypto.randomUUID().replaceAll('-', '');
  return { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid', OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' } },
    login: { issuer: 'https://identity.example.invalid', clientId: 'public-test-client', scope: 'openid profile', resource: 'https://api.example.invalid' },
  };
}

test('installation produces consistent Worker configs, public-only build settings and exact provider registration values', () => {
  const config = input(); const result = installation(config, process.cwd());
  assert.equal(result.admin.services[0]!.service, result.collector.name);
  assert.equal(result.admin.account_id, result.collector.account_id);
  assert.equal(result.loginSettings.env.VITE_OIDC_ISSUER, result.collector.vars.OIDC_ISSUER);
  assert.equal(result.registration.redirectUri, config.adminOrigin + '/auth/callback');
  assert.equal(result.registration.accessToken.audience, 'test-api');
  assert.equal(result.registration.resource, config.login.resource); // resource mapping is provider-owned, not assumed equal to audience.
  assert.equal(result.registration.clientType, 'public'); assert.equal(result.registration.pkceMethod, 'S256');
  assert.equal(Object.keys(result.loginSettings.env).some(key => !key.startsWith('VITE_OIDC_')), false);
  const serialized = JSON.stringify(result.loginSettings);
  assert.ok(!serialized.includes(config.collector.databaseId)); assert.ok(!serialized.includes(config.admin.accountId));
  assert.ok(!serialized.includes('OIDC_JWKS_URI')); assert.ok(!serialized.includes('test-api'));
  const custom = installation({ ...config, adminOrigin: 'https://admin.unit-testing.com', admin: { ...config.admin, workersDev: false, domain: 'admin.unit-testing.com' } }, process.cwd());
  assert.equal(custom.registration.browserOrigin, 'https://admin.unit-testing.com');
});

test('installation rejects cross-account/service/issuer/origin mismatches and private or malformed login settings', () => {
  for (const edit of [
    (c: any) => { c.admin.accountId = crypto.randomUUID().replaceAll('-', ''); },
    (c: any) => { c.admin.collectorWorkerName = 'other-collector'; },
    (c: any) => { c.login.issuer += '/other'; },
    (c: any) => { c.login.clientSecret = 'never-accepted'; },
    (c: any) => { c.collector.settings.TOKEN = 'never-accepted'; },
    (c: any) => { c.login.scope = 'profile'; },
    (c: any) => { c.login.idTokenAlgorithm = 'HS256'; },
    ...['http://test-admin.fixture.workers.dev', 'https://other.fixture.workers.dev', 'https://test-admin.fixture.workers.dev/',
      'https://test-admin.fixture.workers.dev?x=1', 'https://test-admin.fixture.workers.dev#x', 'https://user:pass@test-admin.fixture.workers.dev',
      'https://test-admin.fixture.workers.dev:8443'].map(value => (c: any) => { c.adminOrigin = value; }),
  ]) { const config = input(); edit(config); assert.throws(() => installation(config, process.cwd()), /Invalid installation configuration/); }
});

test('installation CLI creates a complete new directory, never overwrites existing artifacts and rejects invalid input before writing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-installation-')); const file = join(directory, 'input.json');
  const output = join(directory, 'prepared'); const cli = fileURLToPath(new URL('../prepare-installation.ts', import.meta.url));
  const exec = promisify(execFile);
  try {
    const help = await exec(process.execPath, [cli, '--help']); assert.match(help.stdout, /No upload, login, migration, grant or provider registration/);
    await writeFile(file, JSON.stringify(input()));
    const args = [cli, '--file', file, '--out', output]; const result = await exec(process.execPath, args);
    assert.equal(JSON.parse(result.stdout).remoteChanges, false);
    assert.deepEqual((await readdir(output)).sort(), ['admin-login.json', 'admin.wrangler.json', 'collector.wrangler.json', 'installation.json', 'oidc-registration.json']);
    assert.equal(JSON.parse(await readFile(join(output, 'admin.wrangler.json'), 'utf8')).assets.directory, join(output, 'admin-assets'));
    const original = await readFile(join(output, 'admin-login.json'), 'utf8');
    assert.equal(JSON.parse(original).env.VITE_OIDC_CLIENT_ID, 'public-test-client');
    await assert.rejects(exec(process.execPath, args)); assert.equal(await readFile(join(output, 'admin-login.json'), 'utf8'), original);
    const bad = input(); bad.login.issuer += '/wrong'; await writeFile(file, JSON.stringify(bad));
    const failedOutput = join(directory, 'failed'); await assert.rejects(exec(process.execPath, [cli, '--file', file, '--out', failedOutput]));
    await assert.rejects(readdir(failedOutput), { code: 'ENOENT' });
    await writeFile(file, ' '.repeat(32769));
    await assert.rejects(exec(process.execPath, [cli, '--file', file, '--out', failedOutput]));
    await assert.rejects(exec(process.execPath, [cli, '--remote']), error => {
      const result = error as Error & { stderr: string }; assert.equal(JSON.parse(result.stderr).code, 'installation_config_failed'); return true;
    });
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  }
});
