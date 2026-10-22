/** End this caller's wait without canceling shared key resolution. */
export async function awaitSignal<T>(signal: AbortSignal, work: () => T | PromiseLike<T>): Promise<T> {
  signal.throwIfAborted();
  let stop = () => {};
  try {
    const result = await new Promise<T>((resolve, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      try { Promise.resolve(work()).then(resolve, reject); } catch (error) { reject(error); }
    });
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener('abort', stop); }
}

export function discard(body: ReadableStream<Uint8Array> | null): void {
  try { void body?.cancel().catch(() => {}); } catch { /* Cleanup cannot delay authentication. */ }
}
