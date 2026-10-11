import { mkdir, open, unlink, rmdir, type FileHandle } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { installation } from './installation.ts';

/** Shared by JSON and guided setup. Validate first; never overwrite an existing bundle. */
export async function writeInstallation(input: unknown, root: string, directory: string, signal?: AbortSignal,
  createFile: (path: string) => Promise<Pick<FileHandle, 'writeFile' | 'close'>> = path => open(path, 'wx', 0o600)) {
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
      const file = await createFile(path);
      // Exclusive creation establishes ownership before a write can fail or be aborted.
      written.push(path);
      try {
        signal?.throwIfAborted();
        await file.writeFile(JSON.stringify(value, null, 2) + '\n', { signal });
      } finally {
        await file.close();
      }
    }
    signal?.throwIfAborted();
  } catch (error) {
    for (const path of written) await unlink(path).catch(() => {});
    await rmdir(output).catch(() => {}); throw error;
  }
  return { prepared: true, remoteChanges: false, output, files: artifacts.map(([name]) => name) };
}
