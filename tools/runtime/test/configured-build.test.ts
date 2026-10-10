import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparedInstallation } from '../prepared-installation.ts';
import { installation } from '../installation.ts';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../', import.meta.url));
async function prepare(directory: string) {
  const accountId = crypto.randomUUID().replaceAll('-', '');
  const input = { adminOrigin: 'https://test-admin.fixture.workers.dev',
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid', OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' } },
    login: { issuer: 'https://identity.example.invalid', clientId: 'configured-build-public-client', scope: 'openid' },
  };
  const plan = installation(input, root, directory);
  await mkdir(directory);
  for (const [name, value] of [['installation.json', plan.manifest], ['admin.wrangler.json', plan.admin],
    ['collector.wrangler.json', plan.collector], ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration]] as const)
    await writeFile(join(directory, name), JSON.stringify(value));
  return { plan, input };
}
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-configured-build-'));
  try { await run(directory); }
  finally { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); }
}

test('prepared installation rejects mismatched, oversized and incomplete artifacts before creating build output', async () => {
  await temporary(async directory => {
    const out = join(directory, 'installation'); await prepare(out);
    assert.equal((await preparedInstallation(out, root)).loginSettings.env.VITE_OIDC_CLIENT_ID, 'configured-build-public-client');
    const original = await readFile(join(out, 'admin-login.json'), 'utf8');
    const changed = JSON.parse(original); changed.env.VITE_OIDC_CLIENT_ID = 'different-client';
    await writeFile(join(out, 'admin-login.json'), JSON.stringify(changed));
    await assert.rejects(preparedInstallation(out, root), /Invalid prepared installation/);
    const exec = promisify(execFile);
    await assert.rejects(exec(process.execPath, [join(root, 'apps/admin/scripts/build-configured.mjs'), '--dir', out]));
    await assert.rejects(readdir(join(out, 'admin-assets')), { code: 'ENOENT' });
    await writeFile(join(out, 'admin-login.json'), ' '.repeat(32769));
    await assert.rejects(preparedInstallation(out, root), /Invalid prepared installation/);
    await writeFile(join(out, 'admin-login.json'), original);
    const collector = JSON.parse(await readFile(join(out, 'collector.wrangler.json'), 'utf8')); collector.vars.OIDC_ISSUER += '/other';
    await writeFile(join(out, 'collector.wrangler.json'), JSON.stringify(collector));
    await assert.rejects(preparedInstallation(out, root), /Invalid prepared installation/);
  });
});

test('configured admin builds the actual app with approved public settings, excludes ambient VITE values and preserves earlier builds', async () => {
  await temporary(async directory => {
    const out = join(directory, 'installation'); const { input } = await prepare(out);
    const cli = join(root, 'apps/admin/scripts/build-configured.mjs'); const exec = promisify(execFile);
    const poison = 'AMBIENT_VITE_MUST_NOT_APPEAR_7d8d';
    const result = await exec(process.execPath, [cli, '--dir', out], { cwd: root, env: { ...process.env,
      VITE_OIDC_CLIENT_ID: poison, VITE_UNRELATED_PRIVATE: poison, NODE_ENV: 'development',
      TALLYFIN_COLLECTOR_ORIGIN: 'https://do-not-use.example.invalid' }, maxBuffer: 1024 * 1024 });
    assert.match(result.stdout, /"built":true/);
    const assets = join(out, 'admin-assets'); const manifest = JSON.parse(await readFile(join(assets, '.vite/manifest.json'), 'utf8'));
    const chunks = await Promise.all(Object.values(manifest).map(async (chunk: any) => chunk.file.endsWith('.js') ? readFile(join(assets, chunk.file), 'utf8') : ''));
    const code = chunks.join('\n');
    assert.ok(code.includes(input.login.clientId)); assert.ok(code.includes(input.login.issuer));
    for (const value of [poison, input.admin.accountId, input.collector.databaseId, 'OIDC_JWKS_URI']) assert.ok(!code.includes(value));
    const entry = Object.keys(manifest).find(key => manifest[key].isEntry)!; const seen = new Set<string>();
    function graph(key: string) { if (seen.has(key)) return; seen.add(key); for (const dependency of manifest[key].imports ?? []) graph(dependency); }
    graph(entry);
    let initialGzip = 0;
    for (const key of seen) initialGzip += gzipSync(await readFile(join(assets, manifest[key].file))).length;
    assert.ok(initialGzip <= 100 * 1024, `configured initial JS ${initialGzip} exceeds 100 KiB`);
    assert.equal(seen.has('src/auth/OidcLogin.tsx'), false);
    const receipt = await readFile(join(out, 'admin-build.json'), 'utf8'); assert.equal(JSON.parse(receipt).remoteChanges, false);
    const packaged = await exec(process.execPath, [join(root, 'tools/runtime/dry-run-admin.ts'), '--config',
      join(out, 'admin.wrangler.json'), '--outdir', join(directory, 'worker-bundle')], { cwd: root });
    assert.match(packaged.stdout, /env.COLLECTOR/); assert.match(packaged.stdout, /test-collector/);
    assert.match(packaged.stdout, /--dry-run: exiting now/);
    for (const args of [['--remote'], ['--config', 'first', '--config', 'second']])
      await assert.rejects(exec(process.execPath, [join(root, 'tools/runtime/dry-run-admin.ts'), ...args]), error => {
        const result = error as Error & { stderr: string }; assert.equal(JSON.parse(result.stderr).code, 'admin_dry_run_failed'); return true;
      });
    await assert.rejects(exec(process.execPath, [cli, '--dir', out])); assert.equal(await readFile(join(out, 'admin-build.json'), 'utf8'), receipt);
    const help = await exec(process.execPath, [cli, '--help']); assert.match(help.stdout, /No upload or provider contact/);
  });
});
