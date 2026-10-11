import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfinServer, ServerInputError } from '../src/index.ts';
import type { ServerOptions, ServerPlatform, ServerSchema } from '../src/index.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const wall = Date.parse('2026-10-11T10:00:00Z');
const schema: ServerSchema = { version: 1, events: { job_finished: {
  outcome: ['enum', true, ['success', 'failure']], retried: ['boolean', false], shards: ['integer', false, 0, 2],
} } };
function fixture(options: Partial<ServerOptions> = {}) {
  const h = {
    elapsed: 0, uuids: 0, tokens: 0, waits: [] as number[],
    calls: [] as { endpoint: string; body: string; init: RequestInit }[],
    reply: async (_index: number, count: number): Promise<Response> => Response.json({ accepted: count, duplicates: 0 }),
  };
  const host: ServerPlatform = { now: () => wall + h.elapsed, monotonicNow: () => h.elapsed,
    uuid: () => { h.uuids++; return crypto.randomUUID(); },
    fetch: async (url, init) => {
      const body = init!.body as string; h.calls.push({ endpoint: String(url), body, init: init! });
      return h.reply(h.calls.length - 1, JSON.parse(body).events.length);
    },
    wait: async ms => { h.waits.push(ms); h.elapsed += ms; },
  };
  // These test-only strings are not credentials. They only enter a mocked transport.
  const config: ServerOptions = { endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
    schema: structuredClone(schema), getToken: () => { h.tokens++; return 'not-a-credential-' + h.tokens; }, ...options };
  const client = createTallyfinServer(config, host);
  const event = () => client.createEvent('job_finished', { outcome: 'success', retried: false });
  return { h, host, config, client, event };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('configuration is inert, schema is snapshotted, events are immutable and send is an awaited closed server batch', async () => {
  const { h, client, config, event } = fixture();
  assert.equal(h.tokens, 0); assert.equal(h.calls.length, 0); assert.equal(h.uuids, 0);
  (config.schema.events as any).injected = {};
  assert.throws(() => client.createEvent('injected'), ServerInputError);
  const props = { outcome: 'success', retried: false }; const e = client.createEvent('job_finished', props);
  props.outcome = 'failure';
  assert.equal(e.properties.outcome, 'success'); assert.ok(Object.isFrozen(e)); assert.ok(Object.isFrozen(e.properties));
  assert.equal(e.occurredAt, '2026-10-11T10:00:00.000Z');
  assert.equal(h.calls.length, 0);
  assert.deepEqual(await client.send([e, event()]), { status: 'delivered', accepted: 2, duplicates: 0, attempts: 1 });
  const body = JSON.parse(h.calls[0]!.body);
  assert.equal(body.source, 'server'); assert.equal(body.schemaVersion, 1);
  assert.deepEqual(Object.keys(body).sort(), ['events', 'schemaVersion', 'source']);
  assert.deepEqual(Object.keys(body.events[0]).sort(), ['eventId', 'name', 'occurredAt', 'properties']);
  const init = h.calls[0]!.init;
  assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.cache, 'no-store');
  assert.deepEqual(Object.keys(init.headers!), ['Content-Type', 'Authorization']);
});

test('persisted UUID/time round-trip, optional false/zero rules and UTC calendar/time bounds are enforced locally', async () => {
  const { h, client, event } = fixture();
  const original = event();
  const restored = client.createEvent(original.name, original.properties, { eventId: original.eventId, occurredAt: '2026-10-11T10:00:00Z' });
  assert.deepEqual(restored, original); assert.equal(h.uuids, 1);
  assert.equal(client.createEvent('job_finished', { outcome: 'success', retried: false, shards: 0 }).properties.shards, 0);
  assert.equal((await client.send([JSON.parse(JSON.stringify(restored))])).status, 'delivered');
  for (const props of [{}, { outcome: 'free text' }, { outcome: 'success', retried: 0 }, { outcome: 'success', shards: 4 },
    { outcome: 'success', shards: 1.5 }, { outcome: 'success', private_detail: 'secret' }])
    assert.throws(() => client.createEvent('job_finished', props as any), ServerInputError);
  for (const metadata of [{ eventId: null }, { eventId: 'invalid' }, { occurredAt: null }, { occurredAt: '2026-02-30T10:00:00Z' },
    { occurredAt: '2026-10-10T09:59:59Z' }, { occurredAt: '2026-10-11T10:05:01Z' },
    { occurredAt: '2026-10-11T10:00:00.1234Z' }, { occurredAt: '2026-10-11T10:00:00+00:00' }, { attempt: {} }])
    assert.throws(() => client.createEvent('job_finished', { outcome: 'success' }, metadata as any), ServerInputError);
  assert.equal((await client.send([])).status, 'rejected');
  assert.equal((await client.send(Array.from({ length: 21 }, event))).status, 'rejected');
  assert.equal((await client.send([original, original])).status, 'rejected');
  assert.equal((await client.send([{ ...original, attempt: {} } as any])).status, 'rejected');
  assert.equal((await client.send([{ ...original, properties: { outcome: 'private-detail' } }])).status, 'rejected');
  assert.equal(h.calls.length, 1);
});

test('configuration rejects unsafe endpoints, malformed rules and oversized definitions without side effects', () => {
  const f = fixture();
  for (const endpoint of ['http://collector.example.invalid/v1/projects/jobs/server-batches',
    'https://user:private-detail@collector.example.invalid/v1/projects/jobs/server-batches',
    f.config.endpoint + '?token=private-detail', f.config.endpoint + '#fragment',
    'https://collector.example.invalid/v1/projects/jobs/batches'])
    assert.throws(() => createTallyfinServer({ ...f.config, endpoint }, f.host), { message: 'Invalid server SDK configuration.' });
  assert.ok(createTallyfinServer({ ...f.config, endpoint: 'http://127.0.0.1/v1/projects/jobs/server-batches', allowLocalHttp: true }, f.host));
  for (const invalid of [{ version: 0, events: {} }, { version: 1, events: {}, workflows: {} },
    { version: 1, events: { job: { kind: ['enum', true, ['bad value']] } } },
    { version: 1, events: { job: { count: ['integer', true, 0, 33] } } },
    { version: 1, events: { job: { kind: ['enum', true, ['ok', 'ok']] } } },
    { version: 1, events: { job: { private_detail: ['enum', true, ['x'.repeat(33000)]] } } }])
    assert.throws(() => createTallyfinServer({ ...f.config, schema: invalid as any }, f.host), TypeError);
  for (const invalid of [{ maxAttempts: 4 }, { requestTimeoutMs: 0 }, { retryBudgetMs: 600001 }, { getToken: undefined }])
    assert.throws(() => createTallyfinServer({ ...f.config, ...invalid } as any, f.host), TypeError);
  assert.equal(f.h.calls.length, 0); assert.equal(f.h.tokens, 0);
});

test('transient retry keeps the exact body and refreshes only the credential; caller mutation cannot change an in-flight batch', async () => {
  const { h, client, event } = fixture();
  const value = JSON.parse(JSON.stringify(event()));
  h.reply = async index => {
    if (index === 0) { value.properties.outcome = 'failure'; value.eventId = crypto.randomUUID(); return new Response('private-detail', { status: 503, headers: { 'Retry-After': '2' } }); }
    return Response.json({ accepted: 0, duplicates: 1 });
  };
  assert.deepEqual(await client.send([value]), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 2 });
  assert.deepEqual(h.waits, [2000]); assert.equal(h.calls[0]!.body, h.calls[1]!.body);
  assert.equal(JSON.parse(h.calls[1]!.body).events[0].properties.outcome, 'success');
  assert.notDeepEqual(h.calls[0]!.init.headers, h.calls[1]!.init.headers);
  assert.equal(h.tokens, 2);
});

test('permanent server denials stop immediately and cancel the untrusted error response without exposing its text', async () => {
  for (const status of [400, 401, 403, 409, 413, 415, 422]) {
    const { h, client, event } = fixture(); let cancelled = false;
    h.reply = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status });
    const result = await client.send([event()]);
    assert.deepEqual(result, { status: 'rejected', reason: 'http_error', httpStatus: status, retryable: false, attempts: 1 });
    assert.equal(h.calls.length, 1); assert.deepEqual(h.waits, []); assert.equal(cancelled, true);
  }
});

test('network failures, 408 and 5xx are bounded and sanitized; exhausted delivery can be retried with the original event', async () => {
  for (const status of [0, 408, 500, 502, 503]) {
    const { h, client, event } = fixture();
    h.reply = async () => { if (!status) throw Error('private-detail'); return new Response(null, { status }); };
    const e = event(); const result = await client.send([e]);
    assert.equal(result.status, 'unavailable'); assert.equal(result.attempts, 3); assert.equal(h.calls.length, 3);
    assert.ok(!JSON.stringify(result).includes('private-detail')); assert.deepEqual(h.waits, [1000, 2000]);
    assert.ok(h.calls.every(call => call.body === h.calls[0]!.body));
    h.reply = async () => Response.json({ accepted: 0, duplicates: 1 });
    assert.equal((await client.send([e])).status, 'delivered');
    assert.equal(h.calls.at(-1)!.body, h.calls[0]!.body);
  }
});

test('Retry-After supports seconds and HTTP dates, refuses waits beyond budget and uses monotonic elapsed time', async () => {
  const seconds = fixture(); seconds.h.reply = async index => index === 0 ? new Response(null, { status: 429, headers: { 'Retry-After': '3' } })
    : Response.json({ accepted: 1, duplicates: 0 });
  assert.equal((await seconds.client.send([seconds.event()])).status, 'delivered');
  assert.deepEqual(seconds.h.waits, [3000]);
  const date = fixture(); date.h.reply = async index => index === 0 ? new Response(null, { status: 503,
    headers: { 'Retry-After': new Date(wall + 4000).toUTCString() } }) : Response.json({ accepted: 1, duplicates: 0 });
  assert.equal((await date.client.send([date.event()])).status, 'delivered'); assert.deepEqual(date.h.waits, [4000]);
  const deferred = fixture(); deferred.h.reply = async () => new Response(null, { status: 429, headers: { 'Retry-After': '86400' } });
  assert.deepEqual(await deferred.client.send([deferred.event()]), { status: 'unavailable', reason: 'retry_deferred', httpStatus: 429, retryable: true, attempts: 1 });
  assert.deepEqual(deferred.h.waits, []);
  const clock = fixture({ retryBudgetMs: 1500 }); const e = clock.event();
  clock.host.now = () => wall - 1000; clock.h.reply = async () => new Response(null, { status: 503 });
  const result = await clock.client.send([e]); assert.equal(result.status, 'unavailable'); assert.equal(result.attempts, 2);
  assert.deepEqual(clock.h.waits, [1000]);
});

test('only bounded valid JSON receipts prove delivery; malformed, oversized, extra-field and unexpected responses remain uncertain', async () => {
  for (const make of [
    () => Response.json({ accepted: 0, duplicates: 0 }), () => Response.json({ accepted: 2, duplicates: 0 }),
    () => Response.json({ accepted: 1, duplicates: 0, private_detail: 'secret' }),
    () => Response.json({ accepted: '1', duplicates: 0 }),
    () => new Response(' '.repeat(1025), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('private-detail', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response(null, { status: 204 }), () => Response.json({ accepted: 1, duplicates: 0 }, { status: 201 }),
  ]) {
    const { h, client, event } = fixture({ maxAttempts: 1 }); h.reply = async () => make();
    const result = await client.send([event()]);
    assert.deepEqual(result, { status: 'unavailable', reason: 'invalid_response', httpStatus: make().status, retryable: true, attempts: 1 });
    assert.ok(!JSON.stringify(result).includes('private-detail'));
  }
});

test('token failures and invalid header values never reach the collector or reveal provider errors', async () => {
  for (const getToken of [() => { throw Error('private-detail'); }, () => '', () => 'private-detail\nheader',
    () => 'a,b', () => 'x'.repeat(8186)]) {
    const { h, client, event } = fixture({ getToken });
    assert.deepEqual(await client.send([event()]), { status: 'unavailable', reason: 'authentication_unavailable', httpStatus: null, retryable: true, attempts: 0 });
    assert.equal(h.calls.length, 0); assert.deepEqual(h.waits, []);
  }
});

test('credential timeout aborts the provider, and a late credential cannot launch an unobserved request', async () => {
  let release!: (token: string) => void; let signal!: AbortSignal;
  const { h, client, event } = fixture({ maxAttempts: 1, requestTimeoutMs: 20,
    getToken: s => { signal = s; return new Promise(resolve => { release = resolve; }); } });
  const result = await client.send([event()]);
  assert.equal(result.status, 'unavailable'); assert.equal(result.attempts, 0); assert.equal(signal.aborted, true);
  release('not-a-credential'); await tick();
  assert.equal(h.calls.length, 0);
});

test('request and streaming receipt timeouts abort work and cancel a stalled body', async () => {
  const request = fixture({ maxAttempts: 1, requestTimeoutMs: 20 });
  request.h.reply = async () => new Promise(() => {});
  const result = await request.client.send([request.event()]);
  assert.equal(result.status, 'unavailable'); assert.equal(request.h.calls[0]!.init.signal!.aborted, true);
  const body = fixture({ maxAttempts: 1, requestTimeoutMs: 20 }); let cancelled = false;
  body.h.reply = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { 'Content-Type': 'application/json' } });
  assert.equal((await body.client.send([body.event()])).status, 'unavailable');
  await tick(); assert.equal(cancelled, true);
});

test('caller cancellation covers already-aborted requests, token acquisition and retry sleep without another request', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  assert.equal((await f.client.send([f.event()], { signal: controller.signal })).status, 'aborted'); assert.equal(f.h.calls.length, 0);
  const key = new AbortController(); let provider!: AbortSignal;
  const token = fixture({ getToken: s => { provider = s; return new Promise(() => {}); } });
  const sending = token.client.send([token.event()], { signal: key.signal }); await tick(); key.abort();
  assert.equal((await sending).status, 'aborted'); assert.equal(provider.aborted, true); assert.equal(token.h.calls.length, 0);
  const sleep = fixture(); const parent = new AbortController(); let wake!: () => void;
  const sleeping = new Promise<void>(resolve => { wake = resolve; }); let waitSignal!: AbortSignal;
  sleep.h.reply = async () => new Response(null, { status: 503 });
  sleep.host.wait = async (_ms, s) => { waitSignal = s; wake(); return new Promise(() => {}); };
  const pending = sleep.client.send([sleep.event()], { signal: parent.signal }); await sleeping; parent.abort();
  const result = await pending;
  assert.equal(result.status, 'aborted'); assert.equal(result.attempts, 1); assert.equal(waitSignal.aborted, true);
});

test('bundled ESM exports work in Node and contain no core, storage, browser or external runtime dependencies', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))], bundle: true,
    write: false, format: 'esm', platform: 'neutral', target: 'es2023', metafile: true });
  assert.ok(Object.values(result.metafile.outputs).every(output => !output.imports.length));
  assert.equal(Object.keys(result.metafile.inputs).length, 1);
  const sdk = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'));
  const f = fixture(); const client = sdk.createTallyfinServer(f.config, f.host);
  const e = client.createEvent('job_finished', { outcome: 'success' });
  assert.deepEqual(await client.send([e]), { status: 'delivered', accepted: 1, duplicates: 0, attempts: 1 });
});

test('response cleanup failures cannot retry a permanent denial or change an invalid receipt outcome', async () => {
  for (const status of [401, 403, 422, 200]) {
    for (const cleanup of ['reject', 'stall']) {
      const f = fixture({ maxAttempts: 2, requestTimeoutMs: 20 }); let cancellations = 0;
      f.h.reply = async () => new Response(new ReadableStream({ cancel() {
        cancellations++;
        return cleanup === 'reject' ? Promise.reject(Error('private cleanup detail')) : new Promise(() => {});
      } }), { status, ...(status === 200 ? { headers: { 'Content-Type': 'text/plain' } } : {}) });
      const result = await f.client.send([f.event()]);
      assert.deepEqual(result, status === 200
        ? { status: 'unavailable', reason: 'invalid_response', httpStatus: 200, retryable: true, attempts: 2 }
        : { status: 'rejected', reason: 'http_error', httpStatus: status, retryable: false, attempts: 1 });
      assert.equal(cancellations, result.attempts);
      assert.ok(!JSON.stringify(result).includes('private cleanup detail'));
    }
  }
});

test('oversized receipt does not await a stalled stream cancellation', async () => {
  const f = fixture({ maxAttempts: 1, requestTimeoutMs: 20 }); let cancelled = false;
  f.h.reply = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1025)); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await f.client.send([f.event()]),
    { status: 'unavailable', reason: 'invalid_response', httpStatus: 200, retryable: true, attempts: 1 });
  assert.equal(cancelled, true);
});

test('late response from a timed-out attempt is cancelled and cannot overwrite the active attempt status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  const f = fixture({ maxAttempts: 2, requestTimeoutMs: 20 });
  let release!: (response: Response) => void, rejectSecond!: (error: Error) => void;
  f.h.reply = index => new Promise((resolve, reject) => { if (!index) release = resolve; else rejectSecond = reject; });
  const sending = f.client.send([f.event()]);
  await turn(); t.mock.timers.tick(20); await turn();
  assert.equal(f.h.calls.length, 2);
  assert.equal(f.h.calls[0]!.init.signal!.aborted, true);
  let cancelled = false;
  const late = new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { 'Content-Type': 'application/json' } });
  release(late); await turn();
  rejectSecond(Error('private transport detail'));
  assert.deepEqual(await sending,
    { status: 'unavailable', reason: 'transport_unavailable', httpStatus: null, retryable: true, attempts: 2 });
  assert.equal(cancelled, true); assert.equal(late.body!.locked, false);
  assert.equal(f.h.calls[0]!.body, f.h.calls[1]!.body);
});

test('a late response after caller cancellation is discarded even when stream cleanup rejects', async () => {
  const f = fixture(); const parent = new AbortController();
  let release!: (response: Response) => void;
  f.h.reply = () => new Promise(resolve => { release = resolve; });
  const sending = f.client.send([f.event()], { signal: parent.signal });
  await tick(); parent.abort();
  assert.deepEqual(await sending,
    { status: 'aborted', reason: 'aborted', httpStatus: null, retryable: false, attempts: 1 });
  let cancelled = false;
  const late = new Response(new ReadableStream({ cancel() {
    cancelled = true; return Promise.reject(Error('private cleanup detail'));
  } }), { headers: { 'Content-Type': 'application/json' } });
  release(late); await tick();
  assert.equal(cancelled, true); assert.equal(late.body!.locked, false);
  assert.equal(f.h.calls.length, 1); assert.deepEqual(f.h.waits, []);
});
