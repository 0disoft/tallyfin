export type Value = string | boolean | number;
export type Properties = Readonly<Record<string, Value>>;
export type Rule = readonly ['boolean', boolean] | readonly ['enum', boolean, readonly string[]] |
  readonly ['integer', boolean, number, number];
/** Null preserves a non-server milestone's position without shipping its event definition. */
export interface ServerFunnel { steps: readonly (string | null)[]; dimensions: readonly string[] }
export interface FunnelLink { readonly funnelId: string; readonly runId: string; readonly startedAt: string }
/** Build-time projection of reviewed server definitions only; never workflows or browser definitions. */
export interface ServerSchema {
  version: number; events: Readonly<Record<string, Readonly<Record<string, Rule>>>>;
  funnels?: Readonly<Record<string, ServerFunnel>>;
}
export interface ServerEvent {
  readonly eventId: string; readonly name: string; readonly occurredAt: string; readonly properties: Properties;
  readonly funnel?: FunnelLink;
}
export interface ServerOptions {
  endpoint: string; schema: ServerSchema;
  /** Obtain a dedicated publisher credential. It is never persisted by this SDK. */
  getToken(signal: AbortSignal): string | Promise<string>;
  allowLocalHttp?: boolean;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  retryBudgetMs?: number;
}
export type FailureReason = 'invalid_batch' | 'invalid_event' | 'authentication_unavailable' |
  'transport_unavailable' | 'invalid_response' | 'http_error' | 'retry_deferred' | 'aborted';
export type DeliveryResult =
  { status: 'delivered'; accepted: number; duplicates: number; attempts: number } |
  { status: 'rejected' | 'unavailable' | 'aborted'; reason: FailureReason; httpStatus: number | null; retryable: boolean; attempts: number };
export interface ServerClient {
  /** Preserve the returned ID/time/content for delivery retries, including process restarts. */
  createEvent(name: string, properties?: Properties, metadata?: { eventId?: string; occurredAt?: string; funnel?: FunnelLink }): ServerEvent;
  /** New random identity for a server-started task; never a visitor identifier or credential. */
  createFunnelRun(funnelId: string): FunnelLink;
  /** One atomic batch of 1..20 events. No implicit queue, listener or fire-and-forget work. */
  send(events: readonly ServerEvent[], options?: { signal?: AbortSignal }): Promise<DeliveryResult>;
}
export interface ServerPlatform {
  now(): number;
  monotonicNow(): number;
  uuid(): string;
  fetch: typeof fetch;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}
export class ServerInputError extends Error {
  readonly code = 'invalid_event';
  constructor() { super('Invalid or unregistered server event.'); }
}
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const ENUM = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = (value: unknown, low: number, high: number): value is number => Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.hasOwn(value, key);
const aborted = Symbol('aborted'); const timedOut = Symbol('timedOut'); const authFailed = Symbol('authFailed'); const badResponse = Symbol('badResponse');

function schemaValid(value: unknown): value is ServerSchema {
  if (!record(value) || Object.keys(value).some(key => !['events', 'version', 'funnels'].includes(key)) ||
    !integer(value.version, 1, 2147483647) || !record(value.events)) return false;
  const events = Object.entries(value.events);
  if (!events.length || events.length > 50) return false;
  for (const [name, properties] of events) {
    if (!NAME.test(name) || !record(properties) || Object.keys(properties).length > 4) return false;
    let combinations = 1;
    for (const [key, rule] of Object.entries(properties)) {
      if (!NAME.test(key) || !Array.isArray(rule) || typeof rule[1] !== 'boolean') return false;
      let count: number;
      // Normalize the private snapshot so equivalent enum domains compare equally.
      if (rule[0] === 'boolean' && rule.length === 2) count = 2;
      else if (rule[0] === 'enum' && rule.length === 3 && Array.isArray(rule[2]) &&
        rule[2].every(value => typeof value === 'string' && ENUM.test(value)) && new Set(rule[2]).size === rule[2].length) count = rule[2].sort().length;
      else if (rule[0] === 'integer' && rule.length === 4 && integer(rule[2], -1000000, 1000000) &&
        integer(rule[3], -1000000, 1000000)) count = rule[3] - rule[2] + 1;
      else return false;
      if (count < 1 || count > 32) return false;
      combinations *= count + (rule[1] ? 0 : 1);
    }
    if (combinations > 256) return false;
  }
  if (own(value, 'funnels')) {
    if (!record(value.funnels) || Object.keys(value.funnels).length > 10) return false;
    for (const [id, funnel] of Object.entries(value.funnels)) {
      if (!NAME.test(id) || !record(funnel) || Object.keys(funnel).sort().join(',') !== 'dimensions,steps' ||
        !Array.isArray(funnel.steps) || funnel.steps.length < 2 || funnel.steps.length > 10 ||
        !Array.isArray(funnel.dimensions) || funnel.dimensions.length > 4 ||
        funnel.dimensions.some(key => typeof key !== 'string' || !NAME.test(key)) ||
        new Set(funnel.dimensions).size !== funnel.dimensions.length) return false;
      const names = funnel.steps.filter(name => name !== null);
      if (!names.length || new Set(names).size !== names.length) return false;
      for (const name of names) {
        if (typeof name !== 'string' || !own(value.events, name)) return false;
        const rules = value.events[name] as Record<string, Rule>, first = value.events[names[0] as string] as Record<string, Rule>;
        for (const key of funnel.dimensions)
          if (!own(rules, key) || !rules[key]?.[1] || JSON.stringify(rules[key]) !== JSON.stringify(first[key])) return false;
      }
    }
  }
  return true;
}
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) throw new ServerInputError();
  const ms = Date.parse(value);
  const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, digits: string) => '.' + digits.padEnd(3, '0') + 'Z')
    : value.replace('Z', '.000Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== normalized) throw new ServerInputError();
  return normalized;
}
function eventSnapshot(value: unknown, schema: ServerSchema, now: number): ServerEvent {
  if (!record(value) || Object.keys(value).some(key => !['eventId', 'name', 'occurredAt', 'properties', 'funnel'].includes(key)) ||
    !['eventId', 'name', 'occurredAt', 'properties'].every(key => own(value, key)) ||
    typeof value.eventId !== 'string' || !UUID.test(value.eventId) || typeof value.name !== 'string' ||
    !own(schema.events, value.name) || !record(value.properties)) throw new ServerInputError();
  const rules = schema.events[value.name]!; const properties: [string, Value][] = [];
  for (const [key, item] of Object.entries(value.properties)) {
    if (!own(rules, key)) throw new ServerInputError();
    const rule = rules[key]!;
    if (!(rule[0] === 'boolean' ? typeof item === 'boolean' : rule[0] === 'enum' ? typeof item === 'string' && rule[2].includes(item)
      : integer(item, rule[2], rule[3]))) throw new ServerInputError();
    properties.push([key, item as Value]);
  }
  if (Object.entries(rules).some(([key, rule]) => rule[1] && !own(value.properties as object, key))) throw new ServerInputError();
  const occurredAt = utc(value.occurredAt); const ms = Date.parse(occurredAt);
  if (!integer(now, 0, 8640000000000000) || ms < now - 86400000 || ms > now + 300000) throw new ServerInputError();
  properties.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const funnel = own(value, 'funnel') ? linkSnapshot(value.funnel, value.name, schema, ms) : undefined;
  return Object.freeze({ eventId: value.eventId, name: value.name, occurredAt, properties: Object.freeze(Object.fromEntries(properties)),
    ...(funnel ? { funnel } : {}) });
}
function linkSnapshot(value: unknown, name: string, schema: ServerSchema, occurredAt: number): FunnelLink {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'funnelId,runId,startedAt' ||
    typeof value.funnelId !== 'string' || !schema.funnels || !own(schema.funnels, value.funnelId) ||
    typeof value.runId !== 'string' || !UUID.test(value.runId)) throw new ServerInputError();
  const index = schema.funnels[value.funnelId]!.steps.indexOf(name), startedAt = utc(value.startedAt), start = Date.parse(startedAt);
  if (index < 0 || start > occurredAt || occurredAt - start > 86400000 || index === 0 && start !== occurredAt) throw new ServerInputError();
  return Object.freeze({ funnelId: value.funnelId, runId: value.runId, startedAt });
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
    const stop = () => { cleanup(); reject(aborted); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
  });
}
function platform(): ServerPlatform {
  return { now: () => Date.now(), monotonicNow: () => performance.now(), uuid: () => crypto.randomUUID(),
    fetch: (input, init) => globalThis.fetch(input, init), wait };
}
/** Timeout covers credential acquisition, request and response body; all timers/listeners are removed. */
async function limited<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  let stop = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      stop = () => { controller.abort(); reject(aborted); };
      if (parent?.aborted) { stop(); return; }
      parent?.addEventListener('abort', stop, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(timedOut); }, milliseconds);
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw aborted;
        return work(controller.signal);
      }).then(resolve, reject);
    });
  } finally { clearTimeout(timer!); parent?.removeEventListener('abort', stop); controller.abort(); }
}
/** Cleanup must not delay delivery results or replace their original failure classification. */
function discardBody(body: ReadableStream<Uint8Array> | null): void {
  try { void body?.cancel().catch(() => {}); } catch { /* A host-provided stream may throw during cleanup. */ }
}
async function receipt(response: Response, count: number, signal: AbortSignal): Promise<{ accepted: number; duplicates: number }> {
  const length = response.headers.get('Content-Length');
  if (!response.body || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(response.headers.get('Content-Type') ?? '') ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024))) {
    discardBody(response.body); throw badResponse;
  }
  const reader = response.body.getReader(); const buffer = new Uint8Array(1024); let size = 0;
  let complete = false, cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try { void reader.cancel().catch(() => {}); } catch { /* Cleanup cannot change the result. */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw aborted;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      if (size + chunk.value.byteLength > buffer.length) throw badResponse;
      buffer.set(chunk.value, size); size += chunk.value.byteLength;
    }
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!record(result) || Object.keys(result).sort().join(',') !== 'accepted,duplicates' ||
      !integer(result.accepted, 0, count) || !integer(result.duplicates, 0, count) || result.accepted + result.duplicates !== count) throw badResponse;
    complete = true;
    return { accepted: result.accepted, duplicates: result.duplicates };
  } catch (error) { throw error === aborted ? aborted : badResponse; }
  finally { signal.removeEventListener('abort', cancel); if (!complete) cancel(); reader.releaseLock(); }
}
function retryDelay(header: string | null, attempt: number, now: number): number {
  if (header !== null && header.length <= 128) {
    if (/^\d+$/.test(header)) return Math.max(1000, Number(header) * 1000);
    // Date.parse normalizes nonexistent days and ignores mismatched weekdays.
    if (header.length === 29 && new Date(header).toUTCString() === header)
      return Math.max(1000, Date.parse(header) - now);
  }
  return 1000 * 2 ** (attempt - 1);
}
export function createTallyfinServer(options: ServerOptions, host: ServerPlatform = platform()): ServerClient {
  let schema: ServerSchema; let endpoint: string;
  const attempts = options.maxAttempts ?? 3; const timeout = options.requestTimeoutMs ?? 5000; const budget = options.retryBudgetMs ?? 30000;
  try {
    const url = new URL(options.endpoint); const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
      !/^\/v1\/projects\/[a-z][a-z0-9-]{0,47}\/server-batches$/.test(url.pathname) ||
      !(url.protocol === 'https:' || (options.allowLocalHttp === true && local && url.protocol === 'http:')) ||
      typeof options.getToken !== 'function' || !integer(attempts, 1, 3) || !integer(timeout, 10, 30000) || !integer(budget, 10, 600000) ||
      [host.now, host.monotonicNow, host.uuid, host.fetch, host.wait].some(fn => typeof fn !== 'function')) throw Error();
    const text = JSON.stringify(options.schema);
    if (text.length > 32768) throw Error();
    const copy: unknown = JSON.parse(text); if (!schemaValid(copy)) throw Error();
    schema = copy; endpoint = url.href;
  } catch { throw new TypeError('Invalid server SDK configuration.'); }
  const getToken = options.getToken; const encoder = new TextEncoder();
  return {
    createEvent(name, properties = {}, metadata = {}) {
      try {
        if (!record(metadata) || Object.keys(metadata).some(key => !['eventId', 'occurredAt', 'funnel'].includes(key))) throw new ServerInputError();
        const now = host.now();
        const first = metadata.funnel && schema.funnels?.[metadata.funnel.funnelId]?.steps[0] === name;
        return eventSnapshot({ eventId: metadata.eventId === undefined ? host.uuid() : metadata.eventId, name,
          occurredAt: metadata.occurredAt === undefined ? (first ? metadata.funnel!.startedAt : new Date(now).toISOString()) : metadata.occurredAt, properties,
          ...(metadata.funnel !== undefined ? { funnel: metadata.funnel } : {}) }, schema, now);
      } catch { throw new ServerInputError(); }
    },
    createFunnelRun(funnelId) {
      try {
        if (!schema.funnels || !own(schema.funnels, funnelId) || schema.funnels[funnelId]!.steps[0] === null) throw new ServerInputError();
        const now = host.now(), name = schema.funnels[funnelId]!.steps[0]!;
        if (!integer(now, 0, 8640000000000000)) throw new ServerInputError();
        return linkSnapshot({ funnelId, runId: host.uuid(), startedAt: new Date(now).toISOString() }, name, schema, now);
      } catch { throw new ServerInputError(); }
    },
    async send(events, sendOptions = {}) {
      let sent = 0; let httpStatus: number | null = null;
      const fail = (status: 'rejected' | 'unavailable' | 'aborted', reason: FailureReason, retryable: boolean): DeliveryResult =>
        ({ status, reason, httpStatus, retryable, attempts: sent });
      const signal = sendOptions.signal;
      if (signal?.aborted) return fail('aborted', 'aborted', false);
      let body: string; let count: number;
      try {
        if (!Array.isArray(events) || !events.length || events.length > 20) return fail('rejected', 'invalid_batch', false);
        const now = host.now(); const snapshot: ServerEvent[] = [];
        // Array.map skips holes, which JSON would serialize as null. Inspect every own slot.
        count = events.length;
        for (let index = 0; index < count; index++) {
          if (!own(events, String(index))) throw new ServerInputError();
          snapshot.push(eventSnapshot(events[index], schema, now));
        }
        if (new Set(snapshot.map(e => e.eventId)).size !== snapshot.length) return fail('rejected', 'invalid_batch', false);
        body = JSON.stringify({ schemaVersion: schema.version, source: 'server', events: snapshot });
        if (encoder.encode(body).byteLength > 16384) return fail('rejected', 'invalid_batch', false);
      } catch { return fail('rejected', 'invalid_event', false); }
      const deadline = host.monotonicNow() + budget;
      let reason: FailureReason = 'transport_unavailable';
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const remaining = deadline - host.monotonicNow();
        if (remaining <= 0) return fail('unavailable', 'retry_deferred', true);
        const requestDeadline = Math.min(deadline, host.monotonicNow() + timeout);
        let header: string | null = null; let issued = false;
        try {
          const outcome = await limited(async requestSignal => {
            let token: string;
            try { token = await getToken(requestSignal); }
            catch { throw authFailed; }
            if (requestSignal.aborted) throw aborted;
            // Synchronous credential work can outlast the timer before the event loop runs it.
            if (host.monotonicNow() >= requestDeadline) throw timedOut;
            if (typeof token !== 'string' || !token || token.length > 8185 || /[\s,]/.test(token)) throw authFailed;
            issued = true; sent++;
            const response = await host.fetch(endpoint, { method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body,
              signal: requestSignal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
            if (requestSignal.aborted) { discardBody(response.body); throw aborted; }
            httpStatus = response.status; header = response.headers.get('Retry-After');
            if (response.status === 200) return await receipt(response, count, requestSignal);
            discardBody(response.body);
            return null;
          }, Math.min(timeout, remaining), signal);
          if (outcome) return { status: 'delivered', ...outcome, attempts: sent };
          reason = 'http_error';
          if (httpStatus !== 429 && httpStatus !== 408 && !(httpStatus! >= 500 && httpStatus! <= 599))
            return httpStatus! >= 400 && httpStatus! < 500 ? fail('rejected', reason, false) : fail('unavailable', 'invalid_response', true);
        } catch (error) {
          if (signal?.aborted || error === aborted) return fail('aborted', 'aborted', false);
          if (!issued || error === authFailed) return fail('unavailable', 'authentication_unavailable', true);
          reason = error === badResponse ? 'invalid_response' : 'transport_unavailable';
        }
        if (attempt === attempts) return fail('unavailable', reason, true);
        const delay = retryDelay(header, attempt, host.now());
        const remainingWait = deadline - host.monotonicNow();
        if (delay >= remainingWait) return fail('unavailable', 'retry_deferred', true);
        try { await limited(waitSignal => host.wait(delay, waitSignal), remainingWait, signal); }
        catch { return signal?.aborted ? fail('aborted', 'aborted', false) : fail('unavailable', 'retry_deferred', true); }
      }
      return fail('unavailable', reason, true);
    },
  };
}
