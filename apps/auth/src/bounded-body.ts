const BODY_LIMIT = 16384;

/** The caller owns the deadline; transport cleanup must never delay its result. */
export async function readAuthBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  let complete = false, canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    try { void reader.cancel().catch(() => {}); } catch { /* Preserve the original failure. */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) { complete = true; break; }
      size += next.value.byteLength;
      if (size > BODY_LIMIT) throw new RangeError('Request too large');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}
