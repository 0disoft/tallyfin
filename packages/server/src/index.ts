import { SERVER_DELIVERY_POLICY as DELIVERY } from './policy.ts';

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
  /** Retry jitter sample in 0..1. Legacy injected hosts default to zero jitter. */
  random?(): number;
  uuid(): string;
  fetch: typeof fetch;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
  /** Schedule a deadline and return its cancellation function. */
  timer?(callback: () => void, milliseconds: number): () => void;
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
    fetch: (input, init) => globalThis.fetch(input, init), wait, random: Math.random };
}
function timer(callback: () => void, milliseconds: number): () => void {
  const id = setTimeout(callback, milliseconds); return () => clearTimeout(id);
}
/** Timeout covers credential acquisition, request and response body; all timers/listeners are removed. */
async function limited<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number,
  schedule: (callback: () => void, milliseconds: number) => () => void, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController(); let cancelTimer: (() => void) | undefined;
  let stop = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      stop = () => { controller.abort(parent?.reason); reject(aborted); };
      if (parent?.aborted) { stop(); return; }
      parent?.addEventListener('abort', stop, { once: true });
      cancelTimer = schedule(() => { controller.abort(); reject(timedOut); }, milliseconds);
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw aborted;
        return work(controller.signal);
      }).then(resolve, reject);
    });
  } finally { cancelTimer?.(); parent?.removeEventListener('abort', stop); controller.abort(); }
}
/** Cleanup must not delay delivery results or replace their original failure classification. */
function discardBody(body: ReadableStream<Uint8Array> | null): void {
  try { void body?.cancel().catch(() => {}); } catch { /* A host-provided stream may throw during cleanup. */ }
}
async function receipt(response: Response, count: number, signal: AbortSignal): Promise<{ accepted: number; duplicates: number }> {
  const length = response.headers.get('Content-Length');
  if (!response.body || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(response.headers.get('Content-Type') ?? '') ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > DELIVERY.maxReceiptBytes))) {
    discardBody(response.body); throw badResponse;
  }
  const reader = response.body.getReader(); const buffer = new Uint8Array(DELIVERY.maxReceiptBytes); let size = 0;
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
  if (header !== null && header.length <= DELIVERY.maxRetryHeaderChars) {
    if (/^\d+$/.test(header)) return Math.max(DELIVERY.retryBaseMs, Number(header) * 1000);
    // Date.parse normalizes nonexistent days and ignores mismatched weekdays.
    if (header.length === 29 && new Date(header).toUTCString() === header)
      return Math.max(DELIVERY.retryBaseMs, Date.parse(header) - now);
  }
  return DELIVERY.retryBaseMs * 2 ** (attempt - 1);
}
type BatchSnapshot = { body: string; count: number } | { reason: 'invalid_batch' | 'invalid_event' };
function snapshotBatch(events: readonly ServerEvent[], schema: ServerSchema, now: () => number): BatchSnapshot {
  try {
    if (!Array.isArray(events) || !events.length || events.length > DELIVERY.maxBatchEvents) return { reason: 'invalid_batch' };
    const time = now(), count = events.length, snapshot: ServerEvent[] = [];
    // Array.map skips holes, which JSON would serialize as null. Inspect every own slot.
    for (let index = 0; index < count; index++) {
      if (!own(events, String(index))) throw new ServerInputError();
      snapshot.push(eventSnapshot(events[index], schema, time));
    }
    if (new Set(snapshot.map(e => e.eventId)).size !== snapshot.length) return { reason: 'invalid_batch' };
    const body = JSON.stringify({ schemaVersion: schema.version, source: 'server', events: snapshot });
    if (new TextEncoder().encode(body).byteLength > DELIVERY.maxBatchBytes) return { reason: 'invalid_batch' };
    return { body, count };
  } catch { return { reason: 'invalid_event' }; }
}

interface AttemptProgress { issued: boolean; sent: number; httpStatus: number | null; header: string | null }
async function sendAttempt(host: ServerPlatform, endpoint: string, body: string, count: number,
  getToken: ServerOptions['getToken'], deadline: number, signal: AbortSignal, progress: AttemptProgress) {
  let token: string;
  try { token = await getToken(signal); }
  catch { throw authFailed; }
  if (signal.aborted) throw aborted;
  // Synchronous credential work can outlast the timer before the event loop runs it.
  if (host.monotonicNow() >= deadline) throw timedOut;
  if (typeof token !== 'string' || !token || token.length > DELIVERY.maxTokenChars || /[\s,]/.test(token)) throw authFailed;
  progress.issued = true; progress.sent++;
  const response = await host.fetch(endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body,
    signal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (signal.aborted) { discardBody(response.body); throw aborted; }
  // Timers may be delayed by synchronous transport work or a busy event loop.
  if (host.monotonicNow() >= deadline) { discardBody(response.body); throw timedOut; }
  progress.httpStatus = response.status; progress.header = response.headers.get('Retry-After');
  if (response.status !== 200) { discardBody(response.body); return null; }
  const result = await receipt(response, count, signal);
  if (host.monotonicNow() >= deadline) throw timedOut;
  return result;
}

function terminalHttpFailure(status: number | null): { status: 'rejected' | 'unavailable'; reason: FailureReason; retryable: boolean } | null {
  if (status === 429 || status === 408 || (status !== null && status >= 500 && status <= 599)) return null;
  if (status !== null && status >= 400 && status < 500) return { status: 'rejected', reason: 'http_error', retryable: false };
  return { status: 'unavailable', reason: 'invalid_response', retryable: true };
}

export function createTallyfinServer(options: ServerOptions, host: ServerPlatform = platform()): ServerClient {
  let schema: ServerSchema; let endpoint: string;
  const attempts = options.maxAttempts ?? DELIVERY.maxAttempts; const timeout = options.requestTimeoutMs ?? DELIVERY.defaultTimeoutMs; const budget = options.retryBudgetMs ?? DELIVERY.defaultBudgetMs;
  try {
    const url = new URL(options.endpoint); const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
      !/^\/v1\/projects\/[a-z][a-z0-9-]{0,47}\/server-batches$/.test(url.pathname) ||
      !(url.protocol === 'https:' || (options.allowLocalHttp === true && local && url.protocol === 'http:')) ||
      typeof options.getToken !== 'function' || !integer(attempts, 1, DELIVERY.maxAttempts) || !integer(timeout, DELIVERY.minTimeoutMs, DELIVERY.maxTimeoutMs) || !integer(budget, DELIVERY.minTimeoutMs, DELIVERY.maxBudgetMs) ||
      [host.now, host.monotonicNow, host.uuid, host.fetch, host.wait].some(fn => typeof fn !== 'function')) throw Error();
    const text = JSON.stringify(options.schema);
    if (text.length > 32768) throw Error();
    const copy: unknown = JSON.parse(text); if (!schemaValid(copy)) throw Error();
    schema = copy; endpoint = url.href;
  } catch { throw new TypeError('Invalid server SDK configuration.'); }
  const getToken = options.getToken;
  const schedule = host.timer ? host.timer.bind(host) : timer;
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
      const progress: AttemptProgress = { issued: false, sent: 0, httpStatus: null, header: null };
      const fail = (status: 'rejected' | 'unavailable' | 'aborted', reason: FailureReason, retryable: boolean): DeliveryResult =>
        ({ status, reason, httpStatus: progress.httpStatus, retryable, attempts: progress.sent });
      const signal = sendOptions.signal;
      if (signal?.aborted) return fail('aborted', 'aborted', false);
      const batch = snapshotBatch(events, schema, () => host.now());
      if ('reason' in batch) return fail('rejected', batch.reason, false);
      const { body, count } = batch;
      const deadline = host.monotonicNow() + budget;
      let reason: FailureReason = 'transport_unavailable';
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const remaining = deadline - host.monotonicNow();
        if (remaining <= 0) return fail('unavailable', 'retry_deferred', true);
        const requestDeadline = Math.min(deadline, host.monotonicNow() + timeout);
        progress.header = null; progress.issued = false;
        try {
          const outcome = await limited(requestSignal => sendAttempt(host, endpoint, body, count, getToken,
            requestDeadline, requestSignal, progress), Math.min(timeout, remaining), schedule, signal);
          if (outcome) return { status: 'delivered', ...outcome, attempts: progress.sent };
          reason = 'http_error';
          const terminal = terminalHttpFailure(progress.httpStatus);
          if (terminal) return fail(terminal.status, terminal.reason, terminal.retryable);
        } catch (error) {
          if (signal?.aborted || error === aborted) return fail('aborted', 'aborted', false);
          if (!progress.issued || error === authFailed) return fail('unavailable', 'authentication_unavailable', true);
          reason = error === badResponse ? 'invalid_response' : 'transport_unavailable';
        }
        if (attempt === attempts) return fail('unavailable', reason, true);
        const delay = retryDelay(progress.header, attempt, host.now())
          + DELIVERY.retryBaseMs * Math.min(1, Math.max(0, host.random?.() || 0));
        const remainingWait = deadline - host.monotonicNow();
        if (delay >= remainingWait) return fail('unavailable', 'retry_deferred', true);
        try { await limited(waitSignal => host.wait(delay, waitSignal), remainingWait, schedule, signal); }
        catch { return signal?.aborted ? fail('aborted', 'aborted', false) : fail('unavailable', 'retry_deferred', true); }
      }
      return fail('unavailable', reason, true);
    },
  };
}
