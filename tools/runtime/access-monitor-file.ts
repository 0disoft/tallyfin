import { open, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { MonitorState } from './access-monitor.ts';

interface MonitorHandle {
  readFile(): Promise<Uint8Array>;
  writeFile(data: string): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface MonitorFiles {
  open(path: string, flags: 'r' | 'wx', mode?: number): Promise<MonitorHandle>;
  lstat(path: string): Promise<{ size: number; isFile(): boolean; isSymbolicLink(): boolean }>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export interface MonitorFileOptions {
  files?: MonitorFiles;
  uuid?: () => string;
  signal?: AbortSignal;
}

/** One cooperating writer per explicit state path. A stale lock is never removed automatically. */
export async function withMonitorFile<T>(path: string, update: (previous: unknown) => Promise<{ nextState: MonitorState; result: T }>,
  options: MonitorFileOptions = {}): Promise<T> {
  const files = options.files ?? { open, lstat, mkdir, rename, unlink }, signal = options.signal;
  signal?.throwIfAborted();
  const statePath = resolve(path), lockPath = statePath + '.lock';
  await files.mkdir(dirname(statePath), { recursive: true });
  signal?.throwIfAborted();
  const lock = await files.open(lockPath, 'wx', 0o600);
  let temporary: string | undefined;
  try {
    signal?.throwIfAborted();
    let previous: unknown = null;
    try {
      const stat = await files.lstat(statePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('invalid-monitor-file');
      const file = await files.open(statePath, 'r');
      try {
        const bytes = await file.readFile();
        if (bytes.byteLength > 4096) throw Error('invalid-monitor-file');
        previous = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (previous === null) throw Error('invalid-monitor-file');
      } finally { await file.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    signal?.throwIfAborted();
    let stop = () => {};
    const observing = new Promise<Awaited<ReturnType<typeof update>>>((resolve, reject) => {
      stop = () => reject(signal?.reason);
      signal?.addEventListener('abort', stop, { once: true });
      Promise.resolve().then(() => { signal?.throwIfAborted(); return update(previous); }).then(resolve, reject);
    });
    const next = await observing.finally(() => signal?.removeEventListener('abort', stop));
    signal?.throwIfAborted();
    const candidate = statePath + '.' + (options.uuid ?? (() => crypto.randomUUID()))() + '.tmp';
    const file = await files.open(candidate, 'wx', 0o600); temporary = candidate;
    try {
      signal?.throwIfAborted();
      await file.writeFile(JSON.stringify(next.nextState) + '\n');
      signal?.throwIfAborted();
      await file.sync();
    } finally { await file.close(); }
    signal?.throwIfAborted();
    // Rename is the commit point. Once it succeeds, report the published result even if aborted.
    await files.rename(candidate, statePath); temporary = undefined;
    return next.result;
  } finally {
    try { if (temporary) await files.unlink(temporary); }
    finally { try { await lock.close(); } finally { await files.unlink(lockPath); } }
  }
}
