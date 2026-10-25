import { D1_POLICY } from './policy.ts';

export interface IngestRetryOptions { signal?: AbortSignal; random?: () => number }

/** Full jitter only follows a named guard failure whose entire write batch rolled back. */
export function ingestRetryDelay(attempt: number, random: () => number = Math.random): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new TypeError('Invalid retry random sample');
  return Math.floor(sample * (Math.min(D1_POLICY.ingestRetryMaxMs, D1_POLICY.ingestRetryBaseMs * 2 ** attempt) + 1));
}

export async function waitForIngestRetry(attempt: number, options: IngestRetryOptions): Promise<void> {
  const { signal } = options;
  signal?.throwIfAborted();
  const delay = ingestRetryDelay(attempt, options.random);
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal!.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
  signal?.throwIfAborted();
}
