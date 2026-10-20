import { open, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { MonitorState } from './access-monitor.ts';

/** One cooperating writer per explicit state path. A stale lock is never removed automatically. */
export async function withMonitorFile<T>(path: string, update: (previous: unknown) => Promise<{ nextState: MonitorState; result: T }>): Promise<T> {
  const statePath = resolve(path), lockPath = statePath + '.lock';
  await mkdir(dirname(statePath), { recursive: true });
  const lock = await open(lockPath, 'wx', 0o600);
  let temporary: string | undefined;
  try {
    let previous: unknown = null;
    try {
      const stat = await lstat(statePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('invalid-monitor-file');
      const file = await open(statePath, 'r');
      try {
        const bytes = await file.readFile();
        if (bytes.byteLength > 4096) throw Error('invalid-monitor-file');
        previous = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (previous === null) throw Error('invalid-monitor-file');
      } finally { await file.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const next = await update(previous);
    const candidate = statePath + '.' + crypto.randomUUID() + '.tmp';
    const file = await open(candidate, 'wx', 0o600); temporary = candidate;
    try { await file.writeFile(JSON.stringify(next.nextState) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(candidate, statePath); temporary = undefined;
    return next.result;
  } finally {
    try { if (temporary) await unlink(temporary); }
    finally { try { await lock.close(); } finally { await unlink(lockPath); } }
  }
}
