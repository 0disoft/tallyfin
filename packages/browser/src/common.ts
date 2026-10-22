import { MAX_BATCH_EVENTS, MAX_PENDING_EVENTS, MAX_HIDDEN_BATCHES, MAX_RETRIES, FLUSH_INTERVAL_MS, REQUEST_TIMEOUT_MS, RETRY_BUDGET_MS, retryDelay } from './delivery-policy.ts';
import type { BrowserOptions, BrowserPlatform, BrowserSchema, Properties } from './types.js';
type EventSchema = Pick<BrowserSchema, 'version' | 'events'>;
interface Transport {
  readonly pending: number;
  snapshot(name: string, properties: Properties): Properties | undefined;
  enqueue(name: string, properties: Properties, occurredAt: number, attachment?: object): boolean;
  flush(): void;
  destroy(): void;
}

export const namePattern = /^[a-z][a-z0-9_]{0,47}$/;
const enumPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const own = Object.hasOwn;
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const integer = (value: unknown, low: number, high: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= low && (value as number) <= high;

function schemaValid(schema: EventSchema): boolean {
  const events = Object.entries(schema.events);
  if (!integer(schema.version, 1, 2147483647) || events.length < 1 || events.length > 50) return false;
  for (const [name, properties] of events) {
    const rules = Object.entries(properties);
    if (!namePattern.test(name) || !record(properties) || rules.length > 4) return false;
    let count = 1;
    for (const [key, rule] of rules) {
      if (!namePattern.test(key) || !Array.isArray(rule) || typeof rule[1] !== 'boolean') return false;
      let values: number;
      // Only the private JSON snapshot is sorted; enum domains are unordered in Core.
      if (rule[0] === 'boolean' && rule.length === 2) values = 2;
      else if (rule[0] === 'enum' && rule.length === 3 && Array.isArray(rule[2]) &&
        rule[2].every(value => typeof value === 'string' && enumPattern.test(value)) && new Set(rule[2].sort()).size === rule[2].length) values = rule[2].length;
      else if (rule[0] === 'integer' && rule.length === 4 && integer(rule[2], -1000000, 1000000) && integer(rule[3], -1000000, 1000000)) values = rule[3] - rule[2] + 1;
      else return false;
      if (values < 1 || values > 32) return false;
      count *= values + (rule[1] ? 0 : 1);
    }
    if (count > 256) return false;
  }
  return true;
}
function browserPlatform(): BrowserPlatform | undefined {
  if (typeof document === 'undefined' || typeof fetch !== 'function' || typeof crypto === 'undefined') return undefined;
  return {
    now: () => Date.now(), monotonicNow: () => performance.now(), uuid: () => crypto.randomUUID(), random: Math.random,
    timer: (callback, milliseconds) => { const id = setTimeout(callback, milliseconds); return () => clearTimeout(id); },
    send(endpoint, body, signal) {
      return globalThis.fetch(endpoint, { method: 'POST', body, signal,
        // Fetch supplies text/plain;charset=UTF-8 for this string body.
        credentials: 'omit',
        keepalive: true, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'manual' }).then(response => {
        // Native fetch defaults to CORS; cleanup must not delay the HTTP status.
        void response.body?.cancel().catch(() => {});
        // A resolved CORS/manual fetch has status 0 only for a filtered redirect; network failures reject.
        return { status: response.status || 300, retryAfter: response.headers.get('Retry-After') };
      });
    },
    // Native sendBeacon forces credentials=include. Keepalive fetch preserves omit/no-referrer.
    onHidden(callback) {
      const listener = () => { if (document.visibilityState === 'hidden') callback(); };
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}
interface Batch {
  // Reserved internal fields: build tooling may shorten them, never wire/public keys.
  __tfBatchBody: string; __tfBatchCount: number; __tfBatchDeadline: number; __tfBatchTries: number;
  __tfBatchStopRetry?: (() => void) | undefined; __tfBatchStopRequest?: (() => void) | undefined;
}

/** Internal shared transport. Public entry points validate their own finite task profiles. */
export function createTransport<Schema extends EventSchema>(options: Omit<BrowserOptions, 'schema'> & { schema: Schema },
  host: BrowserPlatform | undefined, validate: (schema: Schema) => boolean) {
  try {
    if (options.enabled === false) return undefined;
    const platform = host ?? browserPlatform(); if (!platform) return undefined;
    const endpoint = new URL(options.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/v1\/projects\/[a-z][a-z0-9-]{0,47}\/batches$/.test(endpoint.pathname) ||
      !(endpoint.protocol === 'https:' || (options.allowLocalHttp && local && endpoint.protocol === 'http:'))) return undefined;
    const serialized = JSON.stringify(options.schema);
    if (serialized.length > 32768) return undefined;
    const schema: Schema = JSON.parse(serialized);
    if (!schemaValid(schema) || !validate(schema)) return undefined;
    return client(endpoint.href, schema, platform);
  } catch { return undefined; }
}

function client<Schema extends EventSchema>(endpoint: string, schema: Schema, platform: BrowserPlatform): Transport & { schema: Schema; platform: BrowserPlatform } {
  const elapsed = (platform.monotonicNow ?? platform.now).bind(platform);
  const queue: string[] = [];
  const active = new Set<Batch>(); let stopped = false; let draining = false;
  let cancelTimer: (() => void) | undefined;
  const pending = () => {
    let count = queue.length;
    for (const batch of active) count += batch.__tfBatchCount;
    return count;
  };
  const snapshot = (name: string, properties: Properties): Properties | undefined => {
    if (typeof name !== 'string' || !own(schema.events, name) || !record(properties)) return undefined;
    const definitions = schema.events[name]!;
    const entries = Object.entries(properties);
    for (const [key, value] of entries) {
      if (!own(definitions, key)) return undefined;
      const rule = definitions[key]!;
      if (!(rule[0] === 'boolean' ? typeof value === 'boolean' : rule[0] === 'enum'
        ? typeof value === 'string' && rule[2].includes(value)
        : integer(value, rule[2], rule[3]))) return undefined;
    }
    const copy = Object.fromEntries(entries);
    for (const [key, rule] of Object.entries(definitions)) if (rule[1] && !own(copy, key)) return undefined;
    return copy;
  };
  const schedule = (milliseconds: number) => {
    cancelTimer?.(); cancelTimer = platform.timer(() => {
      cancelTimer = undefined;
      if (!stopped && !active.size && queue.length) launch();
    }, milliseconds);
  };
  const prefix = `{"schemaVersion":${schema.version},"source":"browser","events":[`;
  const pack = (): Batch => {
    // At most four 48-character keys/32-character values plus a bounded task link:
    // each validated event is below 800 ASCII bytes, so 20 events fit in 16 KiB.
    const count = Math.min(queue.length, MAX_BATCH_EVENTS), events = queue.slice(0, count).join(',');
    return { __tfBatchBody: prefix + events + ']}', __tfBatchCount: count, __tfBatchDeadline: elapsed() + RETRY_BUDGET_MS, __tfBatchTries: 0 };
  };
  const release = (batch: Batch) => {
    active.delete(batch); batch.__tfBatchStopRequest = undefined;
    if (!active.size) {
      if (queue.length) schedule(draining || queue.length >= MAX_BATCH_EVENTS ? 0 : FLUSH_INTERVAL_MS);
      else { draining = false; cancelTimer?.(); cancelTimer = undefined; }
    }
  };
  const send = (batch: Batch) => {
    if (stopped || !active.has(batch)) return;
    const remaining = batch.__tfBatchDeadline - elapsed();
    if (remaining <= 0) { release(batch); return; }
    const controller = new AbortController(); let finished = false;
    const finish = (status: number, header: string | null = null) => {
      if (finished || stopped || !active.has(batch)) return;
      finished = true; stopTimeout(); batch.__tfBatchStopRequest = undefined;
      if (([0, 408, 429].includes(status) || (status >= 500 && status <= 599)) && batch.__tfBatchTries < MAX_RETRIES) {
        const delay = retryDelay(header, batch.__tfBatchTries, platform.now(), platform.random?.());
        if (delay < batch.__tfBatchDeadline - elapsed()) {
          batch.__tfBatchTries++;
          batch.__tfBatchStopRetry = platform.timer(() => { batch.__tfBatchStopRetry = undefined; send(batch); }, delay);
          return;
        }
      }
      release(batch);
    };
    const stopTimeout = platform.timer(() => { controller.abort(); finish(0); }, Math.min(REQUEST_TIMEOUT_MS, remaining));
    batch.__tfBatchStopRequest = () => { finished = true; stopTimeout(); controller.abort(); };
    try { platform.send(endpoint, batch.__tfBatchBody, controller.signal).then(r => finish(r.status, r.retryAfter), () => finish(0)); }
    catch { finish(0); }
  };
  function launch() {
    const batch = pack();
    queue.splice(0, batch.__tfBatchCount); active.add(batch); send(batch);
  }
  const enqueue = (name: string, properties: Properties, occurredAt: number, attachment?: object) => {
    if (stopped || pending() >= MAX_PENDING_EVENTS) return false;
    const copied = snapshot(name, properties); if (!copied) return false;
    const eventId = platform.uuid(); if (typeof eventId !== 'string' || !uuidPattern.test(eventId)) return false;
    const event = JSON.stringify({ eventId, name, occurredAt: new Date(occurredAt).toISOString(), properties: copied, ...attachment });
    // Finite names, four bounded values and validated task links fit well below one batch.
    queue.push(event);
    if (!active.size && (queue.length >= MAX_BATCH_EVENTS || !cancelTimer)) schedule(queue.length >= MAX_BATCH_EVENTS ? 0 : FLUSH_INTERVAL_MS);
    return true;
  };
  const flush = () => { if (!stopped) { draining = true; if (!active.size && queue.length) schedule(0); } };
  const detach = platform.onHidden?.(() => {
    if (stopped) return;
    draining = true;
    // In-flight requests already use keepalive. Do not bypass a pending Retry-After.
    for (const batch of active) if (batch.__tfBatchStopRetry) return;
    while (queue.length && platform.beacon) {
      const batch = pack(); if (!batch.__tfBatchCount) break;
      try { if (!platform.beacon(endpoint, batch.__tfBatchBody)) break; } catch { break; }
      // Beacon true means browser queue acceptance, not a committed server receipt.
      queue.splice(0, batch.__tfBatchCount);
    }
    cancelTimer?.(); cancelTimer = undefined;
    // Start unsent keepalive batches during the visibility callback, before timers can freeze.
    while (queue.length && active.size < MAX_HIDDEN_BATCHES) launch();
  });
  return {
    schema, platform,
    get pending() { return pending(); },
    enqueue, snapshot, flush,
    destroy() {
      if (!stopped) {
        stopped = true; cancelTimer?.();
        for (const batch of active) { batch.__tfBatchStopRetry?.(); batch.__tfBatchStopRequest?.(); }
        detach?.(); queue.length = 0; active.clear();
      }
    },
  };
}
