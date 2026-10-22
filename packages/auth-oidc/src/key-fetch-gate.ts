/** Per-verifier load limit, not a shared I/O object. Each waiter belongs to its request. */
export function createKeyFetchGate(maximum = 2, maxWaiting = 32) {
  let active = 0;
  const waiting = new Set<() => void>();
  return async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    const release = await new Promise<() => void>((resolve, reject) => {
      const stop = () => {
        waiting.delete(grant); signal.removeEventListener('abort', stop); reject(signal.reason);
      };
      const grant = () => {
        waiting.delete(grant); signal.removeEventListener('abort', stop);
        active++; // Reserve before waking the waiter; a newer caller cannot steal its slot.
        let released = false;
        resolve(() => {
          if (released) return;
          released = true; active--; waiting.values().next().value?.();
        });
      };
      if (active < maximum) { grant(); return; }
      if (waiting.size >= maxWaiting) { reject(Error('OIDC key fetch capacity exceeded')); return; }
      waiting.add(grant); signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
    try { signal.throwIfAborted(); return await work(); }
    finally { release(); }
  };
}
