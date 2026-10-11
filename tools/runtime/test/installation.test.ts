import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installation, InstallationConfigError } from '../installation.ts';
import { writeInstallation } from '../write-installation.ts';
import { fileURLToPath } from 'node:url';
import { mkdtemp, open, writeFile, readFile, readdir, rm } from 'node:fs/promises';
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

test('installation removes both complete and partially written files after a write fails or is cancelled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-installation-rollback-'));
  try {
    for (const mode of ['failure', 'cancel'] as const) {
      const output = join(directory, mode), controller = new AbortController();
      let opened = 0, closed = 0;
      await assert.rejects(writeInstallation(input(), process.cwd(), output, controller.signal, async path => {
        const file = await open(path, 'wx', 0o600); opened++;
        return {
          writeFile: async (data, options) => {
            if (path.endsWith('admin.wrangler.json')) {
              await file.writeFile('{"partial":');
              if (mode === 'failure') throw new Error('simulated write failure');
              controller.abort(); controller.signal.throwIfAborted();
            }
            await file.writeFile(data, options);
          },
          close: async () => { await file.close(); closed++; },
        };
      }), mode === 'failure' ? /simulated write failure/ : { name: 'AbortError' });
      assert.equal(opened, 2); assert.equal(closed, opened);
      await assert.rejects(readdir(output), { code: 'ENOENT' });
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  }
});

test('installation rollback preserves a conflicting file created by another writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-installation-conflict-')), output = join(directory, 'prepared');
  try {
    await assert.rejects(writeInstallation(input(), process.cwd(), output, undefined, async path => {
      if (path.endsWith('admin.wrangler.json')) await writeFile(path, 'other writer', { flag: 'wx' });
      return open(path, 'wx', 0o600);
    }), { code: 'EEXIST' });
    assert.deepEqual(await readdir(output), ['admin.wrangler.json']);
    assert.equal(await readFile(join(output, 'admin.wrangler.json'), 'utf8'), 'other writer');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  }
});

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

test('installation errors identify a fixed input field without carrying submitted values or underlying exceptions', () => {
  const cases: [string, (c: any) => void][] = [
    ['input', c => { c.private_token = 'sensitive-input'; }],
    ['admin', c => { c.admin.workerName = 'sensitive-input.invalid'; }],
    ['collector', c => { c.collector.settings.OIDC_JWKS_URI = 'http://sensitive-input.invalid'; }],
    ['admin.accountId', c => { c.admin.accountId = crypto.randomUUID().replaceAll('-', ''); }],
    ['admin.collectorWorkerName', c => { c.admin.collectorWorkerName = 'other-worker'; }],
    ['adminOrigin', c => { c.adminOrigin = 'https://sensitive-input.invalid'; }],
    ['login', c => { c.login.scope = 'profile'; }],
    ['login.issuer', c => { c.login.issuer += '/different'; }],
  ];
  for (const [field, change] of cases) {
    const config = input(); change(config);
    assert.throws(() => installation(config, process.cwd()), error => {
      assert.ok(error instanceof InstallationConfigError); assert.ok(error instanceof TypeError);
      assert.equal(error.field, field); assert.equal(error.message, 'Invalid installation configuration');
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify(error).includes('sensitive-input')); return true;
    });
  }
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
    const failedOutput = join(directory, 'failed');
    await assert.rejects(exec(process.execPath, [cli, '--file', file, '--out', failedOutput]), error => {
      const result = error as Error & { stdout: string; stderr: string };
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.field, 'login.issuer'); assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes(bad.login.issuer)); return true;
    });
    await assert.rejects(readdir(failedOutput), { code: 'ENOENT' });
    await writeFile(file, ' '.repeat(32769));
    await assert.rejects(exec(process.execPath, [cli, '--file', file, '--out', failedOutput]));
    await assert.rejects(exec(process.execPath, [cli, '--remote']), error => {
      const result = error as Error & { stderr: string }; const failure = JSON.parse(result.stderr);
      assert.equal(failure.code, 'installation_config_failed'); assert.equal(failure.field, undefined); return true;
    });
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  }
});
