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

const MAX_MONITOR_FILE_BYTES = 4096;
const nativeFiles: MonitorFiles = { open, lstat, mkdir, rename, unlink };
type Observation<T> = { nextState: MonitorState; result: T };

/** Only remove the lock acquired here; an existing lock belongs to another writer. */
async function withLock<T>(files: MonitorFiles, statePath: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  await files.mkdir(dirname(statePath), { recursive: true });
  signal?.throwIfAborted();
  const lockPath = statePath + '.lock', lock = await files.open(lockPath, 'wx', 0o600);
  try { return await work(); }
  finally { try { await lock.close(); } finally { await files.unlink(lockPath); } }
}

async function readState(files: MonitorFiles, statePath: string): Promise<unknown> {
  try {
    const stat = await files.lstat(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MONITOR_FILE_BYTES) throw Error('invalid-monitor-file');
    const file = await files.open(statePath, 'r');
    try {
      const bytes = await file.readFile();
      if (bytes.byteLength > MAX_MONITOR_FILE_BYTES) throw Error('invalid-monitor-file');
      const previous: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (previous === null) throw Error('invalid-monitor-file');
      return previous;
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** A late observation cannot retain the lock or publish after cancellation. */
async function observeState<T>(previous: unknown, update: (previous: unknown) => Promise<Observation<T>>,
  signal: AbortSignal | undefined): Promise<Observation<T>> {
  let stop = () => {};
  const observing = new Promise<Observation<T>>((resolve, reject) => {
    stop = () => reject(signal?.reason);
    signal?.addEventListener('abort', stop, { once: true });
    Promise.resolve().then(() => { signal?.throwIfAborted(); return update(previous); }).then(resolve, reject);
  });
  return observing.finally(() => signal?.removeEventListener('abort', stop));
}

/** Own the temporary file from successful open until rename or cleanup. */
async function publishState(files: MonitorFiles, statePath: string, state: MonitorState,
  uuid: () => string, signal: AbortSignal | undefined): Promise<void> {
  const candidate = statePath + '.' + uuid() + '.tmp';
  const file = await files.open(candidate, 'wx', 0o600);
  let published = false;
  try {
    try {
      signal?.throwIfAborted();
      await file.writeFile(JSON.stringify(state) + '\n');
      signal?.throwIfAborted();
      await file.sync();
    } finally { await file.close(); }
    signal?.throwIfAborted();
    // Rename is the commit point. Do not check cancellation after successful publication.
    await files.rename(candidate, statePath); published = true;
  } finally { if (!published) await files.unlink(candidate); }
}

/** One cooperating writer per explicit state path. A stale lock is never removed automatically. */
export async function withMonitorFile<T>(path: string, update: (previous: unknown) => Promise<Observation<T>>,
  options: MonitorFileOptions = {}): Promise<T> {
  const files = options.files ?? nativeFiles, signal = options.signal;
  signal?.throwIfAborted();
  const statePath = resolve(path);
  return withLock(files, statePath, signal, async () => {
    signal?.throwIfAborted();
    const previous = await readState(files, statePath);
    signal?.throwIfAborted();
    const next = await observeState(previous, update, signal);
    signal?.throwIfAborted();
    await publishState(files, statePath, next.nextState, options.uuid ?? (() => crypto.randomUUID()), signal);
    return next.result;
  });
}
