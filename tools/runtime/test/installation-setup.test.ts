import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInstallationSetup, type SetupHost } from '../setup-installation.ts';
import { preparedInstallation } from '../prepared-installation.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture(customDomain = false, publisher = true) {
  const entries: [string, string][] = [
    ['Cloudflare account ID', crypto.randomUUID().replaceAll('-', '')],
    ['Administrator HTTPS origin', customDomain ? 'https://admin.unit-testing.com' : 'https://test-admin.fixture.workers.dev'],
    ['Administrator Worker name', 'test-admin'], ['Collector Worker name', 'test-collector'],
    ['D1 database name', 'test-db'], ['D1 database ID', crypto.randomUUID()],
    ['Expose collector', 'n'], ['Administrator OIDC issuer', 'https://identity.example.invalid'],
    ['Administrator access-token JWKS', 'https://identity.example.invalid/jwks'],
    ['Administrator API access-token audience', 'admin-api'], ['Public browser OIDC client ID', 'public-client'],
    ['Browser login scopes', 'openid profile'], ['Browser resource parameter', ''],
    ['Browser ID-token algorithm', 'ES256'], ['Administrator access-token algorithms', 'RS256,ES256'],
    ['Administrator access-token typ', 'at+jwt'], ['Enable separate server', publisher ? 'y' : 'n'],
    ['Publisher OIDC issuer', 'https://machine.example.invalid'], ['Publisher access-token JWKS', 'https://machine.example.invalid/jwks'],
    ['Publisher audience', 'publisher-api'], ['Publisher access-token algorithms', 'RS256'], ['Publisher access-token typ', 'JWT'],
    ['Write these five', 'y'],
  ];
  const notices: string[] = [], results: string[] = [], prompts: string[] = [];
  const host: SetupHost = { interactive: true, ask: async prompt => {
    prompts.push(prompt); const entry = entries.find(([prefix]) => prompt.startsWith(prefix));
    assert.ok(entry, `Unexpected prompt: ${prompt}`); return entry[1];
  }, inform: line => { notices.push(line); }, result: line => { results.push(line); } };
  return { host, entries, notices, results, prompts };
}
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-setup-'));
  try { await run(directory); }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test('guided public setup produces the existing five-file bundle with separate publisher settings and no inferred resource', async () => {
  await withDirectory(async directory => {
    const f = fixture(true), output = join(directory, 'prepared');
    await runInstallationSetup(['--out', output], f.host, root);
    const report = JSON.parse(f.results[0]!); assert.equal(report.prepared, true); assert.equal(report.remoteChanges, false);
    assert.deepEqual((await readdir(output)).sort(), ['admin-login.json', 'admin.wrangler.json', 'collector.wrangler.json', 'installation.json', 'oidc-registration.json']);
    const plan = await preparedInstallation(output, root);
    assert.equal(plan.admin.workers_dev, false); assert.equal(plan.admin.routes?.[0]?.pattern, 'admin.unit-testing.com');
    assert.equal(plan.admin.account_id, plan.collector.account_id); assert.equal(plan.admin.services[0]!.service, plan.collector.name);
    assert.equal(plan.collector.vars.PUBLISHER_OIDC_AUDIENCE, 'publisher-api');
    assert.equal(plan.collector.vars.PUBLISHER_OIDC_TOKEN_TYPE, 'JWT');
    assert.equal(plan.loginSettings.env.VITE_OIDC_ID_TOKEN_ALG, 'ES256');
    assert.equal(plan.registration.accessToken.algorithms, 'RS256,ES256'); assert.equal(plan.registration.resource, undefined);
    const browser = JSON.stringify(plan.loginSettings);
    assert.ok(!browser.includes('publisher-api')); assert.ok(!browser.includes('machine.example.invalid'));
    assert.ok(!browser.includes(plan.collector.account_id));
  });
});

test('workers.dev setup supports explicit resource and disabled publisher; declining confirmation writes nothing', async () => {
  await withDirectory(async directory => {
    const f = fixture(false, false), output = join(directory, 'prepared');
    f.entries.find(([key]) => key === 'Browser resource parameter')![1] = 'https://resource.example.invalid';
    await runInstallationSetup(['--out', output], f.host, root);
    const plan = await preparedInstallation(output, root);
    assert.equal(plan.admin.workers_dev, true); assert.equal(plan.admin.routes, undefined);
    assert.equal(plan.collector.vars.PUBLISHER_AUTH_MODE, 'disabled');
    assert.equal(plan.registration.resource, 'https://resource.example.invalid');
    assert.equal(f.prompts.some(prompt => prompt.startsWith('Publisher OIDC')), false);
    const cancelled = fixture(); cancelled.entries.find(([key]) => key === 'Write these five')![1] = 'n';
    const cancelledOutput = join(directory, 'cancelled');
    await runInstallationSetup(['--out', cancelledOutput], cancelled.host, root);
    assert.deepEqual(JSON.parse(cancelled.results[0]!), { prepared: false, cancelled: true, remoteChanges: false });
    await assert.rejects(readdir(cancelledOutput), { code: 'ENOENT' });
  });
});

test('same-audience answer is retried and invalid inputs stop without files or echoed values', async () => {
  await withDirectory(async directory => {
    const f = fixture(), ask = f.host.ask; let audienceAttempts = 0;
    f.host.ask = prompt => prompt.startsWith('Publisher audience') && audienceAttempts++ === 0 ? Promise.resolve('admin-api') : ask(prompt);
    await runInstallationSetup(['--out', join(directory, 'prepared')], f.host, root);
    assert.equal(audienceAttempts, 2); assert.match(f.notices.join('\n'), /Invalid value/);
    const invalid = fixture(); invalid.entries.find(([key]) => key === 'Cloudflare account ID')![1] = 'private-invalid-value';
    const rejected = join(directory, 'rejected');
    await assert.rejects(runInstallationSetup(['--out', rejected], invalid.host, root), /invalid-setup-answer/);
    assert.equal(invalid.prompts.length, 3); assert.ok(!invalid.notices.join('\n').includes('private-invalid-value'));
    await assert.rejects(readdir(rejected), { code: 'ENOENT' });
  });
});

test('existing directories and noninteractive or unsupported invocation are refused before prompting or modifying files', async () => {
  await withDirectory(async directory => {
    const f = fixture(); await writeFile(join(directory, 'preserve.txt'), 'unchanged');
    await assert.rejects(runInstallationSetup(['--out', directory], f.host, root), /output-already-exists/);
    assert.equal(f.prompts.length, 0); assert.equal(await readFile(join(directory, 'preserve.txt'), 'utf8'), 'unchanged');
    f.host.interactive = false;
    await assert.rejects(runInstallationSetup(['--out', join(directory, 'new')], f.host, root), /interactive-terminal-required/);
    await assert.rejects(runInstallationSetup(['--out', join(directory, 'new'), '--remote'], f.host, root), /invalid-setup-arguments/);
    assert.equal(f.prompts.length, 0);
    const exec = promisify(execFile), cli = fileURLToPath(new URL('../setup-installation.ts', import.meta.url));
    const help = await exec(process.execPath, [cli, '--help']); assert.match(help.stdout, /No login, secret\/token request, network/);
    await assert.rejects(exec(process.execPath, [cli, '--out', join(directory, 'new')]), error => {
      const result = error as Error & { stdout: string; stderr: string };
      assert.equal(result.stdout, ''); assert.deepEqual(JSON.parse(result.stderr), { code: 'installation_setup_failed' }); return true;
    });
    await assert.rejects(readdir(join(directory, 'new')), { code: 'ENOENT' });
  });
});

test('cancellation after answering confirmation cannot start the configuration write', async () => {
  await withDirectory(async directory => {
    const f = fixture(), ask = f.host.ask, controller = new AbortController();
    f.host.signal = controller.signal;
    f.host.ask = async prompt => {
      const answer = await ask(prompt);
      if (prompt.startsWith('Write these five')) controller.abort();
      return answer;
    };
    const output = join(directory, 'cancelled-write');
    await assert.rejects(runInstallationSetup(['--out', output], f.host, root), { name: 'AbortError' });
    assert.deepEqual(f.results, []); await assert.rejects(readdir(output), { code: 'ENOENT' });
  });
});
