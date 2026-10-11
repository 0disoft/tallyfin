import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { installation } from './installation.ts';

/** Shared by JSON and guided setup. Validate first; never overwrite an existing bundle. */
export async function writeInstallation(input: unknown, root: string, directory: string, signal?: AbortSignal) {
  const output = resolve(directory), plan = installation(input, root, output);
  signal?.throwIfAborted();
  const artifacts = [
    ['collector.wrangler.json', plan.collector], ['admin.wrangler.json', plan.admin],
    ['admin-login.json', plan.loginSettings], ['oidc-registration.json', plan.registration],
    ['installation.json', plan.manifest],
  ] as const;
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  const written: string[] = [];
  try {
    for (const [name, value] of artifacts) {
      signal?.throwIfAborted();
      const path = join(output, name);
      await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      written.push(path);
    }
    signal?.throwIfAborted();
  } catch (error) {
    for (const path of written) await unlink(path).catch(() => {});
    await rmdir(output).catch(() => {}); throw error;
  }
  return { prepared: true, remoteChanges: false, output, files: artifacts.map(([name]) => name) };
}
