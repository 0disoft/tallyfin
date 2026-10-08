export type Value = string | boolean | number;
export type Properties = Readonly<Record<string, Value>>;
/** Compact build-time projection of a reviewed registry. No labels, purposes or server definitions. */
export type Rule = readonly ['boolean', boolean] | readonly ['enum', boolean, readonly string[]] |
  readonly ['integer', boolean, number, number];
export interface BrowserSchema {
  version: number;
  events: Readonly<Record<string, Readonly<Record<string, Rule>>>>;
  workflows: Readonly<Record<string, { start: string; success: string; failure?: string; dimensions: readonly string[] }>>;
}
export interface BrowserOptions { endpoint: string; schema: BrowserSchema; allowLocalHttp?: boolean; enabled?: boolean }
export interface AttemptHandle {
  succeed(properties?: Properties): boolean;
  fail(properties?: Properties): boolean;
  cancel(): void;
}
export interface BrowserClient {
  track(name: string, properties?: Properties): boolean;
  start(workflow: string, properties?: Properties): AttemptHandle | undefined;
  /** Schedule delivery without making the caller await network I/O. */
  flush(): void;
  /** Drop in-memory events, abort pending I/O and remove the visibility listener. */
  destroy(): void;
  /** Queue depth, including in-flight/retry events; never a delivered-event count. */
  readonly pending: number;
}
/** Optional host port used for deterministic tests or explicit browser adapters. */
export interface BrowserPlatform {
  now(): number;
  uuid(): string;
  timer(callback: () => void, milliseconds: number): () => void;
  send(endpoint: string, body: string, signal: AbortSignal): Promise<{ status: number; retryAfter: string | null }>;
  beacon?(endpoint: string, body: string): boolean;
  onHidden?(callback: () => void): () => void;
}
const namePattern = /^[a-z][a-z0-9_]{0,47}$/;
const enumPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const own = (value: object, key: string) => Object.hasOwn(value, key);
const empty = (): BrowserClient => ({ track: () => false, start: () => undefined, flush() {}, destroy() {}, pending: 0 });
const integer = (value: number, low: number, high: number) => Number.isSafeInteger(value) && value >= low && value <= high;

function schemaValid(schema: BrowserSchema): boolean {
  if (!integer(schema.version, 1, 2147483647) || Object.keys(schema.events).length < 1 ||
    Object.keys(schema.events).length > 50 || Object.keys(schema.workflows).length > 10) return false;
  for (const [name, properties] of Object.entries(schema.events)) {
    if (!namePattern.test(name) || Object.keys(properties).length > 4) return false;
    let count = 1;
    for (const [key, rule] of Object.entries(properties)) {
      if (!namePattern.test(key) || !Array.isArray(rule) || typeof rule[1] !== 'boolean') return false;
      let values: number;
      if (rule[0] === 'boolean' && rule.length === 2) values = 2;
      else if (rule[0] === 'enum' && rule.length === 3 && Array.isArray(rule[2]) &&
        rule[2].every(value => typeof value === 'string' && enumPattern.test(value)) && new Set(rule[2]).size === rule[2].length) values = rule[2].length;
      else if (rule[0] === 'integer' && rule.length === 4 && integer(rule[2], -1000000, 1000000) && integer(rule[3], -1000000, 1000000)) values = rule[3] - rule[2] + 1;
      else return false;
      if (values < 1 || values > 32) return false;
      count *= values + (rule[1] ? 0 : 1);
    }
    if (count > 256) return false;
  }
  const bound = new Set<string>();
  for (const [id, workflow] of Object.entries(schema.workflows)) {
    if (!namePattern.test(id) || !Array.isArray(workflow.dimensions) || workflow.dimensions.length > 4 || new Set(workflow.dimensions).size !== workflow.dimensions.length) return false;
    const phases = [workflow.start, workflow.success, ...(workflow.failure === undefined ? [] : [workflow.failure])];
    for (const name of phases) {
      if (!own(schema.events, name) || bound.has(name)) return false;
      bound.add(name);
      for (const key of workflow.dimensions) {
        const rule = schema.events[name]![key];
        if (!own(schema.events[name]!, key) || !rule?.[1] || JSON.stringify(rule) !== JSON.stringify(schema.events[workflow.start]![key])) return false;
      }
    }
  }
  return true;
}
function browserPlatform(): BrowserPlatform | undefined {
  if (typeof document === 'undefined' || typeof fetch !== 'function' || typeof crypto === 'undefined') return undefined;
  return {
    now: () => Date.now(), uuid: () => crypto.randomUUID(),
    timer: (callback, milliseconds) => { const id = setTimeout(callback, milliseconds); return () => clearTimeout(id); },
    async send(endpoint, body, signal) {
      const response = await globalThis.fetch(endpoint, { method: 'POST', body, signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, credentials: 'omit',
        keepalive: true, cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors' });
      // Responses are not stored or logged. Cancel the body instead of buffering unbounded data.
      try { await response.body?.cancel(); } catch { /* status and retry policy still apply */ }
      return { status: response.status, retryAfter: response.headers.get('Retry-After') };
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
  body: string; count: number; createdAt: number; tries: number;
  stopRetry?: (() => void) | undefined; stopRequest?: (() => void) | undefined;
}

export function createTallyfin(options: BrowserOptions, host?: BrowserPlatform): BrowserClient {
  try {
    if (options.enabled === false) return empty();
    const platform = host ?? browserPlatform(); if (!platform) return empty();
    const endpoint = new URL(options.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/v1\/projects\/[a-z][a-z0-9-]{0,47}\/batches$/.test(endpoint.pathname) ||
      !(endpoint.protocol === 'https:' || (options.allowLocalHttp && local && endpoint.protocol === 'http:'))) return empty();
    if (JSON.stringify(options.schema).length > 32768) return empty();
    const schema: BrowserSchema = JSON.parse(JSON.stringify(options.schema));
    if (!schemaValid(schema)) return empty();
    return client(endpoint.href, schema, platform);
  } catch { return empty(); }
}

function client(endpoint: string, schema: BrowserSchema, platform: BrowserPlatform): BrowserClient {
  const encoder = new TextEncoder(); const queue: string[] = [];
  const phases = new Set(Object.values(schema.workflows).flatMap(w => [w.start, w.success, w.failure]));
  const active = new Set<Batch>(); let stopped = false; let draining = false;
  let cancelTimer: (() => void) | undefined;
  const pending = () => queue.length + [...active].reduce((count, batch) => count + batch.count, 0);
  const snapshot = (name: string, properties: Properties): Properties | undefined => {
    if (!own(schema.events, name) || !properties || Array.isArray(properties) || typeof properties !== 'object') return undefined;
    const definitions = schema.events[name]!;
    const entries = Object.entries(properties);
    for (const [key, value] of entries) {
      if (!own(definitions, key)) return undefined;
      const rule = definitions[key]!;
      if (!(rule[0] === 'boolean' ? typeof value === 'boolean' : rule[0] === 'enum'
        ? typeof value === 'string' && rule[2].includes(value)
        : typeof value === 'number' && integer(value, rule[2], rule[3]))) return undefined;
    }
    const copy = Object.fromEntries(entries);
    return Object.entries(definitions).every(([key, rule]) => !rule[1] || own(copy, key)) ? copy : undefined;
  };
  const schedule = (milliseconds: number) => {
    cancelTimer?.(); cancelTimer = platform.timer(() => { cancelTimer = undefined; pump(); }, milliseconds);
  };
  const pack = (): Batch => {
    const prefix = `{"schemaVersion":${schema.version},"source":"browser","events":[`;
    let count = 0; let events = '';
    for (const event of queue.slice(0, 20)) {
      const candidate = events + (count ? ',' : '') + event;
      if (encoder.encode(prefix + candidate + ']}').length > 16384) break;
      events = candidate; count++;
    }
    return { body: prefix + events + ']}', count, createdAt: platform.now(), tries: 0 };
  };
  const release = (batch: Batch) => {
    active.delete(batch); batch.stopRequest = undefined;
    if (!active.size) {
      if (queue.length) schedule(draining || queue.length >= 20 ? 0 : 5000);
      else { draining = false; cancelTimer?.(); cancelTimer = undefined; }
    }
  };
  const send = (batch: Batch) => {
    if (stopped || !active.has(batch)) return;
    const remaining = batch.createdAt + 600000 - platform.now();
    if (remaining <= 0) { release(batch); return; }
    const controller = new AbortController(); let finished = false;
    const finish = (status: number, header: string | null = null) => {
      if (finished || stopped || !active.has(batch)) return;
      finished = true; stopTimeout(); batch.stopRequest = undefined;
      if ([0, 429, 503].includes(status) && batch.tries < 2) {
        let delay = 1000 * 2 ** batch.tries;
        if (header !== null && /^\d+$/.test(header)) delay = Math.max(1000, Number(header) * 1000);
        if (platform.now() + delay < batch.createdAt + 600000) {
          batch.tries++;
          batch.stopRetry = platform.timer(() => { batch.stopRetry = undefined; send(batch); }, delay);
          return;
        }
      }
      release(batch);
    };
    const stopTimeout = platform.timer(() => { controller.abort(); finish(0); }, Math.min(10000, remaining));
    batch.stopRequest = () => { finished = true; stopTimeout(); controller.abort(); };
    try { platform.send(endpoint, batch.body, controller.signal).then(r => finish(r.status, r.retryAfter), () => finish(0)); }
    catch { finish(0); }
  };
  function pump() {
    if (stopped || active.size || !queue.length) return;
    launch();
  }
  function launch() {
    const batch = pack(); if (!batch.count) { queue.shift(); schedule(0); return; }
    queue.splice(0, batch.count); active.add(batch); send(batch);
  }
  const enqueue = (name: string, properties: Properties, occurredAt: number, attempt?: { workflowId: string; attemptId: string; startedAt: string }) => {
    if (stopped || pending() >= 40) return false;
    const copied = snapshot(name, properties); if (!copied) return false;
    const eventId = platform.uuid(); if (!uuidPattern.test(eventId)) return false;
    const event = JSON.stringify({ eventId, name, occurredAt: new Date(occurredAt).toISOString(), properties: copied, ...(attempt ? { attempt } : {}) });
    if (encoder.encode(event).length > 16000) return false;
    queue.push(event);
    if (!active.size && (queue.length >= 20 || !cancelTimer)) schedule(queue.length >= 20 ? 0 : 5000);
    return true;
  };
  const flush = () => { if (!stopped) { draining = true; if (!active.size && queue.length) schedule(0); } };
  const detach = platform.onHidden?.(() => {
    if (stopped) return;
    draining = true;
    // In-flight requests already use keepalive. Do not bypass a pending Retry-After.
    if ([...active].some(batch => batch.stopRetry)) return;
    while (queue.length && platform.beacon) {
      const batch = pack(); if (!batch.count) break;
      let queued = false; try { queued = platform.beacon(endpoint, batch.body); } catch { /* fetch fallback */ }
      if (!queued) break;
      // Beacon true means browser queue acceptance, not a committed server receipt.
      queue.splice(0, batch.count);
    }
    cancelTimer?.(); cancelTimer = undefined;
    // Start unsent keepalive batches during the visibility callback, before timers can freeze.
    while (queue.length && active.size < 2) launch();
  });
  return {
    get pending() { return pending(); },
    track(name, properties = {}) {
      try { return !phases.has(name) && enqueue(name, properties, platform.now()); } catch { return false; }
    },
    start(workflowId, properties = {}) {
      try {
        if (!own(schema.workflows, workflowId)) return undefined;
        const workflow = schema.workflows[workflowId]!;
        const copied = snapshot(workflow.start, properties); if (!copied) return undefined;
        const started = platform.now(); const attemptId = platform.uuid();
        if (!uuidPattern.test(attemptId)) return undefined;
        const attempt = { workflowId, attemptId, startedAt: new Date(started).toISOString() };
        if (!enqueue(workflow.start, copied, started, attempt)) return undefined;
        const dimensions = Object.fromEntries(workflow.dimensions.map(key => [key, copied[key]!])) as Properties;
        let ended = false;
        const end = (name: string | undefined, values: Properties = {}) => {
          try {
            const now = platform.now();
            const copied = Object.fromEntries(Object.entries(values));
            if (ended || !name || now < started || now - started > 86400000 ||
              workflow.dimensions.some(key => own(copied, key) && copied[key] !== dimensions[key])) return false;
            if (!enqueue(name, { ...dimensions, ...copied }, now, attempt)) return false;
            ended = true; return true;
          } catch { return false; }
        };
        return { succeed: values => end(workflow.success, values), fail: values => end(workflow.failure, values), cancel() { ended = true; } };
      } catch { return undefined; }
    },
    flush,
    destroy() {
      if (!stopped) {
        stopped = true; cancelTimer?.();
        for (const batch of active) { batch.stopRetry?.(); batch.stopRequest?.(); }
        detach?.(); queue.length = 0; active.clear();
      }
    },
  };
}
