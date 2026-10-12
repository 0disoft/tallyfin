import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { readResponseJson, MAX_ADMIN_RESPONSE_BYTES, MAX_ADMIN_ERROR_BYTES } from './response-body.ts';

const page = { data: [], page: { limit: 25, nextCursor: null } };

test('native JSON rejects an oversized open stream immediately and permits explicit recovery', async t => {
  let canceled = 0, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls > 1) return Response.json(page);
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1).fill(32)); },
      cancel() { canceled++; return new Promise(() => {}); },
    }));
  });
  const client = new ApiClient({ requestTimeoutMs: 1000 }); t.after(() => client.destroy());
  await assert.rejects(client.listProjects(), error => error instanceof ApiError && error.kind === 'contract');
  assert.equal(canceled, 1); assert.equal(calls, 1);
  assert.deepEqual(await client.listProjects(), page);
  assert.equal(calls, 2);
});

test('native oversized error streams preserve denial status instead of waiting for timeout', async t => {
  let canceled = 0, denial;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1).fill(32)); },
    cancel() { canceled++; },
  }), { status: 403 }));
  const client = new ApiClient({ requestTimeoutMs: 1000,
    onAnalyticsAccessDenied: (_projectId, error) => { denial = error; },
  }); t.after(() => client.destroy());
  const started = performance.now();
  await assert.rejects(client.getSummary('sample', { schemaVersion: 1, from: '2026-10-12', to: '2026-10-12' }),
    error => error instanceof ApiError && error.status === 403 && error.kind === 'forbidden');
  assert.ok(performance.now() - started < 500);
  assert.equal(canceled, 1); assert.equal(denial.status, 403);
});

test('declared lengths reject before reading and streamed limits count bytes, not characters', async () => {
  for (const status of [200, 500]) {
    const limit = status === 200 ? MAX_ADMIN_RESPONSE_BYTES : MAX_ADMIN_ERROR_BYTES;
    let canceled = 0;
    const response = new Response(new ReadableStream({ cancel() { canceled++; } }),
      { status, headers: { 'Content-Length': String(limit + 1) } });
    await assert.rejects(readResponseJson(response));
    assert.equal(canceled, 1);
  }
  const text = JSON.stringify('한'.repeat(6000));
  assert.ok(text.length < MAX_ADMIN_ERROR_BYTES);
  await assert.rejects(readResponseJson(new Response(text, { status: 500 })));
});

test('exact bounds and split UTF-8 remain readable, while malformed UTF-8 is rejected', async () => {
  const value = { name: '한글 🎉' }, bytes = new TextEncoder().encode(JSON.stringify(value));
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } }));
  assert.deepEqual(await readResponseJson(response), value);
  const json = JSON.stringify(page);
  for (const status of [200, 500]) {
    const limit = status === 200 ? MAX_ADMIN_RESPONSE_BYTES : MAX_ADMIN_ERROR_BYTES;
    assert.deepEqual(await readResponseJson(new Response(json + ' '.repeat(limit - json.length), { status })), page);
  }
  await assert.rejects(readResponseJson(new Response(Uint8Array.of(34, 0xc3, 34))));
});

test('abort cancels stalled native bodies without letting incomplete JSON prove success', async () => {
  const controller = new AbortController(); let canceled = 0;
  const response = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{')); },
    cancel() { canceled++; },
  }));
  const pending = readResponseJson(response, controller.signal);
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(canceled, 1);
});
