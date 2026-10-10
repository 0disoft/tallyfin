import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDeploymentTarget } from '../admin-target.ts';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Ephemeral syntax-only IDs are never used by a remote command.
const input = () => ({ workerName: 'test-admin', collectorWorkerName: 'test-collector',
  accountId: crypto.randomUUID().replaceAll('-', ''), workersDev: true });

test('admin target reserves API paths and fixes the collector binding and privacy settings', () => {
  const config = input(); const root = process.cwd();
  const target = adminDeploymentTarget(config, root);
  assert.equal(target.main, resolve(root, 'apps/admin/worker/index.js'));
  assert.equal(target.account_id, config.accountId);
  assert.equal(target.assets.directory, resolve(root, 'apps/admin/dist/client'));
  assert.equal(target.assets.not_found_handling, 'none');
  assert.deepEqual(target.assets.run_worker_first, ['/v1', '/v1/*']);
  assert.deepEqual(target.services, [{ binding: 'COLLECTOR', service: config.collectorWorkerName }]);
  assert.equal(target.observability.logs.invocation_logs, false);
  assert.equal(target.observability.traces.enabled, false);
  assert.equal(target.observability.redact_query_string, true);
  assert.equal(target.preview_urls, false);
  assert.equal('vars' in target, false); assert.equal('d1_databases' in target, false);
  const custom = adminDeploymentTarget({ ...config, workersDev: false, domain: 'admin.unit-testing.com' }, root);
  assert.deepEqual(custom.routes, [{ pattern: 'admin.unit-testing.com', custom_domain: true }]);
});

test('admin target rejects missing or ambiguous deployment identifiers, secrets and inaccessible routing', () => {
  const config = input();
  for (const patch of [
    { workerName: '' }, { collectorWorkerName: '' }, { collectorWorkerName: config.workerName },
    { accountId: '0'.repeat(32) }, { workersDev: 'false' }, { workersDev: false },
    { collectorWorkerName: 'https://arbitrary-host.com' }, { token: 'not-allowed' }, { settings: {} },
    ...['https://admin.unit-testing.com', '*.unit-testing.com', 'admin.unit-testing.com/path', 'admin.invalid', 'admin.test', 'localhost', 'a..com', '-a.com', 'a.com:443'].map(domain => ({ domain })),
  ]) assert.throws(() => adminDeploymentTarget({ ...config, ...patch }, process.cwd()), /Invalid admin deployment target configuration/);
});

test('admin preparation writes a new config only, rejects overwrite, oversized files and remote flags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-admin-target-'));
  const file = join(directory, 'input.json'); const output = join(directory, 'output.json');
  const cli = fileURLToPath(new URL('../prepare-admin.ts', import.meta.url)); const exec = promisify(execFile);
  try {
    const help = await exec(process.execPath, [cli, '--help']); assert.match(help.stdout, /No upload, login, migration or resource creation/);
    await writeFile(file, JSON.stringify(input()));
    const args = [cli, '--file', file, '--out', output];
    const result = await exec(process.execPath, args); assert.equal(JSON.parse(result.stdout).remoteChanges, false);
    const content = await readFile(output, 'utf8'); assert.equal(JSON.parse(content).services[0].binding, 'COLLECTOR');
    await assert.rejects(exec(process.execPath, args)); assert.equal(await readFile(output, 'utf8'), content);
    await writeFile(file, ' '.repeat(8193));
    await assert.rejects(exec(process.execPath, [cli, '--file', file, '--out', join(directory, 'oversized.json')]));
    for (const args of [['--remote'], ['--file', file, '--out', output, '--file', file]]) {
      await assert.rejects(exec(process.execPath, [cli, ...args]), error => {
        const result = error as Error & { stderr: string }; assert.equal(JSON.parse(result.stderr).code, 'admin_target_config_failed'); return true;
      });
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
