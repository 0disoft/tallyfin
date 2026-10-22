import { CollectionError, MAX_BODY_BYTES } from '@tallyfin/core';

export async function readBody(request: Request, maximum = MAX_BODY_BYTES,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
  const timeout = options.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new TypeError('Invalid body timeout.');
  const signal = AbortSignal.any([request.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeout)]);
  signal.throwIfAborted();
  const encoding = request.headers.get('Content-Encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw new CollectionError('invalid_request', 415);
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^(application\/json|text\/plain)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type)) throw new CollectionError('invalid_request', 415);
  const length = request.headers.get('Content-Length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new CollectionError('invalid_request', 400);
    if (Number(length) > maximum) throw new CollectionError('invalid_request', 413);
  }
  if (!request.body) throw new CollectionError('invalid_request', 400);
  const reader = request.body.getReader();
  const buffer = new Uint8Array(maximum); let size = 0;
  let complete = false, canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    try { void reader.cancel().catch(() => {}); } catch { /* Cleanup cannot delay the original result. */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break;
      if (size + chunk.value.byteLength > maximum) {
        throw new CollectionError('invalid_request', 413);
      }
      buffer.set(chunk.value, size); size += chunk.value.byteLength;
    }
    complete = true;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch { throw new CollectionError('invalid_request', 400); }
  } finally { signal.removeEventListener('abort', cancel); if (!complete) cancel(); reader.releaseLock(); }
}
