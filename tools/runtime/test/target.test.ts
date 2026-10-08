import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentTarget } from '../target.ts';
import { join, resolve, sep } from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('deployment preparation requires explicit IDs and OIDC and keeps remote resources unchanged', () => {
  // Random identifiers test syntax only; they never target a real Cloudflare account or resource.
  const input = { workerName: 'test-collector', accountId: crypto.randomUUID().replaceAll('-', ''),
    databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
    settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid',
      OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' } };
  const root = process.cwd(); const target = deploymentTarget(input, root);
  assert.equal(target.account_id, input.accountId);
  assert.equal(target.d1_databases[0]!.database_id, input.databaseId);
  assert.equal(target.main, resolve(root, 'apps/collector/src/runtime.ts'));
  assert.equal(target.vars.ALLOW_LOCAL_HTTP, 'false');
  assert.equal(target.workers_dev, false);
  assert.deepEqual(target.triggers.crons, ['* * * * *']);
  assert.equal(target.observability.logs.invocation_logs, false);
  for (const bad of [ { ...input, accountId: '' }, { ...input, databaseId: '' },
    { ...input, settings: { ...input.settings, ALLOW_LOCAL_HTTP: 'true' } },
    { ...input, settings: { ...input.settings, ADMIN_AUTH_MODE: 'disabled' } },
    { ...input, settings: { ...input.settings, OIDC_AUDIENCE: '' } },
    { ...input, settings: { ...input.settings, SECRET: 'never-accepted' } },
    { ...input, token: 'never-accepted' } ])
    assert.throws(() => deploymentTarget(bad, root), { message: 'Invalid deployment target configuration' });
});

test('configuration CLI writes a new reviewed file and refuses to overwrite it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-target-'));
  const input = join(directory, 'input.json'); const output = join(directory, 'output.json');
  const cli = fileURLToPath(new URL('../prepare.ts', import.meta.url));
  const exec = promisify(execFile);
  try {
    await writeFile(input, JSON.stringify({ workerName: 'test-collector', accountId: crypto.randomUUID().replaceAll('-', ''),
      databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid',
        OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' } }));
    const args = [cli, '--file', input, '--out', output];
    const result = await exec(process.execPath, args);
    assert.equal(JSON.parse(result.stdout).remoteChanges, false);
    const content = await readFile(output, 'utf8');
    assert.equal(JSON.parse(content).vars.ADMIN_AUTH_MODE, 'oidc');
    await assert.rejects(exec(process.execPath, args));
    assert.equal(await readFile(output, 'utf8'), content);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('configuration CLI explains its local-only effects and rejects remote commands', async () => {
  const cli = fileURLToPath(new URL('../prepare.ts', import.meta.url));
  const exec = promisify(execFile);
  const result = await exec(process.execPath, [cli, '--help']);
  assert.match(result.stdout, /No upload, login, migration or resource creation/);
  await assert.rejects(exec(process.execPath, [cli, '--remote']), error => {
    const result = error as Error & { code: number; stderr: string };
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stderr).code, 'target_config_failed'); return true;
  });
});
