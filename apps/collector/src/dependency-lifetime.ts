import { CollectionError } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';

/** Bounds the caller's wait; a transport that ignores abort may still finish later. */
export async function awaitDependency<T>(signal: AbortSignal, work: () => PromiseLike<T> | T): Promise<T> {
  signal.throwIfAborted();
  let stop = () => {};
  try {
    const value = await new Promise<T>((resolve, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      try { Promise.resolve(work()).then(resolve, reject); } catch (cause) { reject(cause); }
    });
    signal.throwIfAborted(); return value;
  } finally { signal.removeEventListener('abort', stop); }
}

/** Scalar capacity only. Never share a request's I/O promise with another request. */
export function databaseCapacity(maximum = 16) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('Invalid database capacity');
  let active = 0;
  return <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= maximum) throw new CollectionError('storage_unavailable', 503,
      { cause: new Error('Database capacity exceeded') });
    active++;
    try {
      // Release only on actual I/O settlement, never when its caller stops waiting.
      return Promise.resolve(work()).finally(() => { active--; });
    } catch (cause) { active--; throw cause; }
  };
}

export function requestDatabase(db: SqlDatabase, parent: AbortSignal, capacity: ReturnType<typeof databaseCapacity>,
  timeoutMs = 15_000, clock: () => number = () => performance.now()) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('Invalid request timeout');
  const controller = new AbortController(), deadline = clock() + timeoutMs;
  const timeout = () => controller.abort(new CollectionError('storage_unavailable', 503,
    { cause: new DOMException('Dependency deadline exceeded', 'TimeoutError') }));
  const forward = () => controller.abort(parent.reason);
  const timer = setTimeout(timeout, timeoutMs);
  if (parent.aborted) forward(); else parent.addEventListener('abort', forward, { once: true });
  let closed = false, pending = 0;
  const dispose = () => {
    if (closed && pending === 0) { clearTimeout(timer); parent.removeEventListener('abort', forward); }
  };
  const check = () => {
    if (!controller.signal.aborted && clock() >= deadline) timeout();
    controller.signal.throwIfAborted();
  };
  const scoped: SqlDatabase = {
    prepare: query => db.prepare(query),
    async batch<T>(statements: Parameters<SqlDatabase['batch']>[0]) {
      if (closed) throw new CollectionError('storage_unavailable', 503);
      check(); pending++;
      try {
        const result = await awaitDependency(controller.signal, () => capacity(() => db.batch<T>(statements)));
        check(); return result;
      } finally { pending--; dispose(); }
    },
  };
  return { db: scoped, signal: controller.signal, close() { closed = true; dispose(); } };
}
