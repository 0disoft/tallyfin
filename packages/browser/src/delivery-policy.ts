// Primitive constants allow bundlers to inline these within the 3 KiB budget.
export const MAX_BATCH_EVENTS = 20;
export const MAX_PENDING_EVENTS = 40;
export const MAX_HIDDEN_BATCHES = 2;
export const MAX_RETRIES = 2;
export const FLUSH_INTERVAL_MS = 5000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const RETRY_BUDGET_MS = 600_000;
export const RETRY_BASE_MS = 1000;

/** Retry-After uses wall time; the caller compares this delay with its monotonic deadline. */
export function retryDelay(header: string | null, retries: number, now: number): number {
  let delay = RETRY_BASE_MS * 2 ** retries;
  if (header !== null && /^\d+$/.test(header)) delay = Number(header) * 1000;
  else if (header?.length === 29 && new Date(header).toUTCString() === header)
    delay = Date.parse(header) - now;
  return Math.max(RETRY_BASE_MS, delay);
}
