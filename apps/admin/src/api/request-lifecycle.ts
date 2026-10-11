/** Stop awaiting even when an injected transport ignores abort. Shared login refresh is left running. */
export async function awaitRequest<T>(signal: AbortSignal, work: () => T | PromiseLike<T>): Promise<T> {
  signal.throwIfAborted();
  let stop = () => {};
  try {
    const result = await new Promise<T>((resolve, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      try { Promise.resolve(work()).then(resolve, reject); }
      catch (error) { reject(error); }
    });
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener('abort', stop); }
}
