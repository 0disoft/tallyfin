import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const execute = promisify(execFile), root = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function sourceIdentity(directory) {
  const git = async args => (await execute('git', args, { cwd: directory, windowsHide: true, timeout: 10000 })).stdout.trim();
  if (await git(['status', '--porcelain', '--untracked-files=normal'])) throw Error('uncommitted-source');
  const commit = await git(['rev-parse', 'HEAD']), tree = await git(['rev-parse', 'HEAD^{tree}']);
  assert.match(commit, /^[a-f0-9]{40,64}$/); assert.match(tree, /^[a-f0-9]{40,64}$/);
  return { commit, tree, dirty: false };
}

export async function distribute(directory) {
  const existing = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  assert.equal(existing, undefined, 'Output directory already exists');
  const source = await sourceIdentity(root);
  const verified = await execute(process.execPath, [join(root, 'tools/sdk/verify-packages.mjs')],
    { cwd: root, windowsHide: true, timeout: 135000, maxBuffer: 2 * 1024 * 1024 });
  const report = JSON.parse(verified.stdout);
  assert.equal(report.verified, true); assert.equal(report.consumerOutsideWorkspace, true);
  assert.equal(report.declarationsCompiled, true); assert.equal(report.noticesVerified, true);
  assert.deepEqual(await sourceIdentity(root), source, 'Source changed while packaging');
  const artifacts = [];
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory); // Existing releases are never overwritten.
  for (const artifact of report.artifacts) {
    assert.ok(['@tallyfin/browser', '@tallyfin/server'].includes(artifact.name));
    assert.match(artifact.filename, /^tallyfin-(browser|server)-[0-9.]+\.tgz$/);
    const bytes = await readFile(join(report.output, artifact.filename));
    assert.equal(digest(bytes), artifact.sha256);
    const filename = artifact.filename.replace('.tgz', `-${source.commit.slice(0, 12)}.tgz`);
    await writeFile(join(directory, filename), bytes, { flag: 'wx' });
    artifacts.push({ name: artifact.name, version: artifact.version, filename, bytes: bytes.length, sha256: digest(bytes) });
  }
  assert.deepEqual(artifacts.map(item => item.name).sort(), ['@tallyfin/browser', '@tallyfin/server']);
  const guides = [];
  for (const [file, filename] of [
    ['tools/sdk/README.md', 'sdk-README.md'],
    ['docs/integrations/independent-sites.md', 'independent-sites.md'],
    ['examples/independent-site/README.md', 'site-README.md'],
    ['examples/independent-site/site.example.json', 'site.example.json'],
  ]) {
    const bytes = await readFile(join(root, file));
    await writeFile(join(directory, filename), bytes, { flag: 'wx' });
    guides.push({ filename, sha256: digest(bytes) });
  }
  const manifest = { schemaVersion: 'tallyfin.sdk-distribution/v1', source, artifacts, guides,
    verification: { offlineInstall: true, consumerOutsideWorkspace: true, declarationsCompiled: true,
      entrypoints: ['@tallyfin/browser', '@tallyfin/browser/funnels', '@tallyfin/server'], noticesVerified: true },
    published: false, versionsChanged: false };
  await writeFile(join(directory, 'SHA256SUMS'), [...artifacts, ...guides].map(item => `${item.sha256}  ${item.filename}\n`).join(''), { flag: 'wx' });
  assert.deepEqual(await sourceIdentity(root), source, 'Source changed while writing the distribution');
  // The manifest is the completion marker; incomplete runs retain their files for inspection.
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { ...manifest, output: directory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('npm run sdk:bundle -- --out <new-directory>\nRequires committed, clean source. Builds and verifies offline tarball consumption outside this checkout, then writes commit-labelled tarballs, SHA256SUMS and manifest.json. No npm publication, version change or credentials.');
  } else {
    try {
      assert.equal(args.length, 2); assert.equal(args[0], '--out'); assert.ok(args[1] && !args[1].startsWith('--'));
      console.log(JSON.stringify(await distribute(resolve(args[1]))));
    } catch {
      console.error(JSON.stringify({ code: 'sdk_distribution_failed', message: 'Use clean committed source, a new output directory, and --help. No release is complete without manifest.json.' }));
      process.exitCode = 1;
    }
  }
}
