// Leave room for the bounded daily/breakdown responses, including 31 days of 32 buckets and 10 funnel steps.
export const MAX_ADMIN_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_ADMIN_ERROR_BYTES = 16 * 1024;

/** Bound decoded bytes before parsing. Cleanup never delays or replaces the result. */
export async function readResponseJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const limit = response.ok ? MAX_ADMIN_RESPONSE_BYTES : MAX_ADMIN_ERROR_BYTES;
  const invalid = () => new Error('Invalid administration response body.');
  const length = response.headers.get('Content-Length');
  if (!response.body || length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    try { void response.body?.cancel().catch(() => {}); } catch { /* Best-effort cleanup. */ }
    throw invalid();
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(limit, 4096)), bytes = 0, complete = false, canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    try { void reader.cancel().catch(() => {}); } catch { /* Best-effort cleanup. */ }
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const chunk = await reader.read(); signal?.throwIfAborted();
      if (chunk.done) break;
      const size = bytes + chunk.value.byteLength;
      if (size > limit) throw invalid();
      if (size > buffer.length) {
        const grown = new Uint8Array(Math.min(limit, Math.max(size, buffer.length * 2)));
        grown.set(buffer.subarray(0, bytes)); buffer = grown;
      }
      buffer.set(chunk.value, bytes); bytes = size;
    }
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)));
    complete = true;
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}
