import { closed, integer } from '@tallyfin/core';

/** Public configuration only; a namespace is supplied by the installer, never allocated here. */
export function browserIngestLimit(input: unknown) {
  if (!closed(input, ['namespaceId', 'limit', 'period']) || typeof input.namespaceId !== 'string' ||
    input.namespaceId !== input.namespaceId.trim() || !/^[1-9]\d{0,15}$/.test(input.namespaceId) ||
    !Number.isSafeInteger(Number(input.namespaceId)) || !integer(input.limit, 1, Number.MAX_SAFE_INTEGER) ||
    (input.period !== 10 && input.period !== 60))
    throw new TypeError('Invalid browser ingestion limit');
  return { name: 'BROWSER_INGEST_LIMITER', namespace_id: input.namespaceId,
    simple: { limit: input.limit, period: input.period } };
}
