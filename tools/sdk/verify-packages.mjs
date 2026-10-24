import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url)), execute = promisify(execFile);
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const expected = {
  '@tallyfin/browser': ['LICENSE', 'NOTICE', 'dist/common.d.ts', 'dist/delivery-policy.d.ts', 'dist/funnels.d.ts', 'dist/funnels.js', 'dist/index.d.ts', 'dist/index.js', 'dist/types.d.ts', 'package.json'],
  '@tallyfin/server': ['LICENSE', 'NOTICE', 'dist/index.d.ts', 'dist/index.js', 'dist/policy.d.ts', 'package.json'],
};
const consumerSource = `import { createTallyfin, type BrowserClient } from '@tallyfin/browser';
import { createTallyfinFunnels, type FunnelClient } from '@tallyfin/browser/funnels';
import { createTallyfinServer, type ServerClient } from '@tallyfin/server';
let networkRequests = 0, credentialRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw Error('Unexpected network request'); };
const browser: BrowserClient = createTallyfin({ endpoint: 'https://collector.example.invalid/v1/projects/package-test/batches', enabled: false,
  schema: { version: 1, events: { completed: {} }, workflows: {} } });
const funnel: FunnelClient = createTallyfinFunnels({ endpoint: 'https://collector.example.invalid/v1/projects/package-test/batches', enabled: false,
  schema: { version: 1, events: { started: {}, finished: {} }, funnels: { task: { steps: ['started', 'finished'], dimensions: [] } } } });
if (browser.track('completed') || funnel.track('finished')) throw Error('Disabled browser client accepted an event');
browser.destroy(); funnel.destroy();
const server: ServerClient = createTallyfinServer({ endpoint: 'https://collector.example.invalid/v1/projects/package-test/server-batches',
  schema: { version: 1, events: { completed: {} } }, getToken() { credentialRequests++; throw Error('Unexpected credential request'); } });
const event = server.createEvent('completed');
if (event.name !== 'completed' || typeof event.eventId !== 'string') throw Error('Packed server factory failed');
if (networkRequests || credentialRequests) throw Error('Package smoke performed unexpected I/O');
console.log(JSON.stringify({ standardBrowser: true, funnelBrowser: true, server: true, networkRequests, credentialRequests }));
`;

let output, consumer, phase = 'arguments';
const signal = AbortSignal.timeout(120000);
async function command(file, args, cwd = root) {
  const env = { ...process.env, NODE_OPTIONS: '', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  // npm run re-exports .npmrc allow-scripts as an env/CLI policy; nested project installs reject that layer.
  // Keep the user's .npmrc policy in force and keep lifecycle scripts disabled for pack/install.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  return execute(process.execPath, [file, ...args], { cwd, windowsHide: true, timeout: 45000, signal,
    maxBuffer: 1024 * 1024, env });
}
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run verify:sdk-packages\nBuilds both SDKs with stale-output probes, packs local tarballs offline and installs them outside the checkout. Checks the exact file list, Apache-2.0 metadata, LICENSE/NOTICE contents, ESM entry points and declaration compilation. No registry publication, credentials or version change. Artifacts stay in .tmp/sdk-packages/.');
  } else {
    assert.equal(args.length, 0);
    const parent = resolve(root, '.tmp/sdk-packages'); await mkdir(parent, { recursive: true });
    output = await mkdtemp(join(parent, 'run-'));
    phase = 'build';
    for (const sdk of ['browser', 'server']) {
      const dist = resolve(root, 'packages', sdk, 'dist'); await mkdir(dist, { recursive: true });
      await writeFile(join(dist, 'stale-output-probe.txt'), 'Local packaging regression probe.');
      await command(npm, ['run', 'build', '--workspace', '@tallyfin/' + sdk]);
    }
    phase = 'pack';
    const packed = await command(npm, ['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', output,
      '--workspace', '@tallyfin/browser', '--workspace', '@tallyfin/server']);
    const value = JSON.parse(packed.stdout);
    const packages = Array.isArray(value) ? value : value.name ? [value] : Object.values(value);
    assert.equal(packages.length, 2);
    assert.deepEqual(packages.map(pkg => pkg.name).sort(), Object.keys(expected).sort());
    const artifacts = [];
    for (const pkg of packages) {
      assert.deepEqual(pkg.files.map(file => file.path).sort(), expected[pkg.name]);
      assert.equal(basename(pkg.filename), pkg.filename);
      const manifest = JSON.parse(await readFile(resolve(root, 'packages', pkg.name.split('/')[1], 'package.json'), 'utf8'));
      assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
      assert.equal(Object.keys(manifest.optionalDependencies ?? {}).length, 0);
      const bytes = await readFile(join(output, pkg.filename));
      artifacts.push({ name: pkg.name, version: pkg.version, private: manifest.private === true, filename: pkg.filename,
        sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, files: pkg.files.map(file => file.path) });
    }
    phase = 'install';
    consumer = await mkdtemp(join(tmpdir(), 'tallyfin-sdk-consumer-'));
    const inside = relative(await realpath(root), await realpath(consumer));
    assert.ok(inside.startsWith('..') || isAbsolute(inside), 'Consumer must be outside the checkout');
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    await command(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', '--prefix', consumer, '--workspaces=false',
      ...artifacts.map(artifact => join(output, artifact.filename))], consumer);
    for (const pkg of packages) {
      const installed = join(consumer, 'node_modules', ...pkg.name.split('/'));
      assert.equal(await realpath(installed), installed, 'Installed package must not be a workspace symlink');
      const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
      assert.equal(manifest.license, 'Apache-2.0', `${pkg.name} must declare Apache-2.0`);
      for (const file of ['LICENSE', 'NOTICE']) {
        assert.deepEqual(await readFile(join(installed, file)), await readFile(join(root, file)),
          `${pkg.name}/${file} must match the repository original`);
      }
    }
    phase = 'types';
    await writeFile(join(consumer, 'consumer.ts'), consumerSource);
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext',
      moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], strict: true, types: [], skipLibCheck: false, outDir: 'out' }, files: ['consumer.ts'] }));
    await command(resolve(root, 'node_modules/typescript/bin/tsc'), ['--project', join(consumer, 'tsconfig.json')], consumer);
    phase = 'runtime';
    const executed = await command(join(consumer, 'out/consumer.js'), [], consumer);
    const runtime = JSON.parse(executed.stdout);
    assert.deepEqual(runtime, { standardBrowser: true, funnelBrowser: true, server: true, networkRequests: 0, credentialRequests: 0 });
    const report = { schemaVersion: 'tallyfin.sdk-packages/v1', verified: true, offline: true, consumerOutsideWorkspace: true,
      published: false, versionsChanged: false, declarationsCompiled: true, license: 'Apache-2.0', noticesVerified: true, artifacts, runtime };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, output }));
  }
} catch (error) {
  const failureCode = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'command-failed';
  const npmCodes = [...new Set((error.stderr ?? '').match(/\bE[A-Z_]{3,}\b/g) ?? [])];
  const failure = { verified: false, phase, failureCode, npmCodes };
  if (output) await writeFile(join(output, 'failure.json'), JSON.stringify(failure));
  console.error(JSON.stringify({ code: 'sdk_package_verification_failed', ...failure })); process.exitCode = 1;
} finally {
  if (consumer) {
    assert.equal(dirname(resolve(consumer)), resolve(tmpdir()));
    assert.ok(basename(consumer).startsWith('tallyfin-sdk-consumer-'));
    await rm(consumer, { recursive: true, force: true });
  }
}
