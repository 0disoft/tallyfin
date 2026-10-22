export interface ReadLease {
  track<T>(operation: () => Promise<T>): Promise<T>;
  close(): void;
}

/** One API connection's FIFO read budget. Writes and shared login refresh are not queued here. */
export function createReadScheduler(maximum = 4, maxWaiting = 64) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 16) throw new TypeError('Invalid read concurrency');
  let active = 0;
  const waiting = new Set<() => void>();
  if (!Number.isInteger(maxWaiting) || maxWaiting < 0) throw new TypeError('Invalid read queue capacity');
  const createLease = (): ReadLease => {
    active++;
    let closed = false, released = false, pending = 0;
    const release = () => {
      if (!closed || pending || released) return;
      released = true; active--; waiting.values().next().value?.();
    };
    return {
      track<T>(operation: () => Promise<T>) {
        if (closed) return Promise.reject(new Error('Read lease closed'));
        pending++;
        try { return Promise.resolve(operation()).finally(() => { pending--; release(); }); }
        catch (cause) { pending--; release(); throw cause; }
      },
      close() { closed = true; release(); },
    };
  };
  return (signal: AbortSignal): ReadLease | Promise<ReadLease> => {
    signal.throwIfAborted();
    // Preserve immediate request dispatch when no queueing is needed.
    if (active < maximum) return createLease();
    return new Promise((resolve, reject) => {
      const stop = () => { waiting.delete(grant); signal.removeEventListener('abort', stop); reject(signal.reason); };
      const grant = () => {
        waiting.delete(grant); signal.removeEventListener('abort', stop);
        resolve(createLease());
      };
      if (waiting.size >= maxWaiting) { reject(new Error('Read queue capacity exceeded')); return; }
      waiting.add(grant); signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
  };
}
