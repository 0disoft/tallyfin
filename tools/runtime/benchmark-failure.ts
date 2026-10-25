import { CODES } from './observation-values.ts';

/** Retain correlation data, never arbitrary error text, response bodies or headers. */
export function benchmarkFailure(body: unknown, retryAfter: string | null) {
  const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const id = error && typeof error === 'object' && 'requestId' in error ? error.requestId : null;
  return {
    ...(typeof code === 'string' && (Object.hasOwn(CODES, code) || code === 'admin_api_unavailable') ? { errorCode: code } : {}),
    ...(typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? { requestId: id } : {}),
    ...(retryAfter !== null && /^\d{1,4}$/.test(retryAfter) && Number(retryAfter) <= 3600 ? { retryAfterSeconds: Number(retryAfter) } : {}),
  };
}
