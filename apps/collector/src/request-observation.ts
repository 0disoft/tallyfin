import type { ErrorCode } from '@tallyfin/core';

export type RequestOperation = 'browser_collection' | 'server_collection' | 'administrator' | 'other';
export type LatencyBucket = 'lt_10ms' | 'lt_50ms' | 'lt_250ms' | 'lt_1000ms' | 'gte_1000ms' | 'unknown';
export interface RequestObservation {
  requestId: string; operation: RequestOperation; status: number; code: ErrorCode | 'ok'; latencyBucket: LatencyBucket;
}
export function observationClock(clock: () => number): number | null {
  try { const value = clock(); return Number.isFinite(value) && value >= 0 ? value : null; } catch { return null; }
}
export function latencyBucket(start: number | null, end: number | null): LatencyBucket {
  if (start === null || end === null || end < start) return 'unknown';
  const elapsed = end - start;
  return elapsed < 10 ? 'lt_10ms' : elapsed < 50 ? 'lt_50ms' : elapsed < 250 ? 'lt_250ms' :
    elapsed < 1000 ? 'lt_1000ms' : 'gte_1000ms';
}
/** Random request UUIDs select successful responses without an extra RNG call or shared request state. */
export function sampleRequestObservation(entry: RequestObservation) {
  const success = entry.code === 'ok' && (entry.status === 200 || entry.status === 204);
  if (success && Number.parseInt(entry.requestId.slice(0, 2), 16) >= 4) return null;
  // Explicit projection keeps future/private fields out of the operational log.
  return { event: 'http_request' as const, requestId: entry.requestId, operation: entry.operation,
    status: entry.status, code: entry.code, latencyBucket: entry.latencyBucket, samplingDenominator: success ? 64 : 1 };
}
export function logRequestObservation(entry: RequestObservation): void {
  const sampled = sampleRequestObservation(entry);
  if (!sampled) return;
  const line = JSON.stringify(sampled);
  if (sampled.status >= 500) console.error(line);
  else if (sampled.status >= 400) console.warn(line);
  else console.log(line);
}
