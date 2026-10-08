import { CollectionError, MAX_BODY_BYTES } from '@tallyfin/core';

export async function readBody(request: Request): Promise<string> {
  const encoding = request.headers.get('Content-Encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw new CollectionError('invalid_request', 415);
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^(application\/json|text\/plain)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type)) throw new CollectionError('invalid_request', 415);
  const length = request.headers.get('Content-Length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new CollectionError('invalid_request', 400);
    if (Number(length) > MAX_BODY_BYTES) throw new CollectionError('invalid_request', 413);
  }
  if (!request.body) throw new CollectionError('invalid_request', 400);
  const reader = request.body.getReader();
  const buffer = new Uint8Array(MAX_BODY_BYTES); let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      if (size + chunk.value.byteLength > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* preserve the body-limit error */ }
        throw new CollectionError('invalid_request', 413);
      }
      buffer.set(chunk.value, size); size += chunk.value.byteLength;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch { throw new CollectionError('invalid_request', 400); }
  } finally { reader.releaseLock(); }
}
