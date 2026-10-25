import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { distribute, sourceIdentity } from './distribute.mjs';

test('distribution identity names committed source and rejects tracked edits and untracked input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-source-'));
  const git = args => promisify(execFile)('git', args, { cwd: directory, windowsHide: true });
  try {
    await git(['init', '--quiet']); await writeFile(join(directory, 'source.txt'), 'original');
    await git(['add', 'source.txt']);
    await git(['-c', 'user.name=Package Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    const identity = await sourceIdentity(directory);
    assert.equal(identity.dirty, false); assert.match(identity.commit, /^[a-f0-9]{40,64}$/);
    await writeFile(join(directory, 'source.txt'), 'changed'); await assert.rejects(sourceIdentity(directory), /uncommitted-source/);
    await git(['restore', 'source.txt']); await writeFile(join(directory, 'new-input.txt'), 'untracked');
    await assert.rejects(sourceIdentity(directory), /uncommitted-source/);
    await assert.rejects(distribute(directory), /Output directory already exists/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
