import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBody } from '../src/body.ts';
import { CollectionError } from '@tallyfin/core';

test('chunked body is stopped and canceled as soon as it exceeds the byte limit', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(16000)); controller.enqueue(new Uint8Array(1000)); },
    cancel() { canceled = true; },
  });
  const request = new Request('https://collector.example.invalid', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, duplex: 'half' } as RequestInit);
  await assert.rejects(readBody(request), (e: unknown) => e instanceof CollectionError && e.status === 413);
  assert.equal(canceled, true);
});
test('UTF-8 sequence split between chunks decodes correctly', async () => {
  const bytes = new TextEncoder().encode('{"name":"가"}');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.subarray(0, 10)); controller.enqueue(bytes.subarray(10)); controller.close();
  } });
  const request = new Request('https://collector.example.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
  assert.equal(await readBody(request), '{"name":"가"}');
});

function streamed(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request('https://collector.example.invalid', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body, duplex: 'half', ...(signal ? { signal } : {}) } as RequestInit);
}

test('body byte boundaries and nonsettling cleanup preserve the original limit error', { timeout: 1000 }, async () => {
  for (const size of [16383, 16384, 16385]) {
    let canceled = false;
    const request = streamed(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(size).fill(97)); c.close(); },
      cancel() { canceled = true; return new Promise<void>(() => {}); } }));
    if (size <= 16384) assert.equal((await readBody(request)).length, size);
    else await assert.rejects(readBody(request), (e: unknown) => e instanceof CollectionError && e.status === 413);
    // Closed streams need no underlying cancellation; the oversize stream below exercises cleanup.
    assert.equal(canceled, false);
  }
  let canceled = false;
  const request = streamed(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16385)); },
    cancel() { canceled = true; return new Promise<void>(() => {}); } }));
  await assert.rejects(readBody(request), (e: unknown) => e instanceof CollectionError && e.status === 413);
  assert.equal(canceled, true);
});

test('request and optional caller cancellation interrupt stalled reads even when cleanup never settles', { timeout: 1000 }, async () => {
  for (const supplied of [false, true]) {
    let canceled = false;
    const controller = new AbortController(), reason = Error('test cancellation');
    const request = streamed(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([97])); },
      cancel() { canceled = true; return new Promise<void>(() => {}); } }), supplied ? undefined : controller.signal);
    const reading = readBody(request, undefined, supplied ? { signal: controller.signal } : {});
    controller.abort(reason);
    await assert.rejects(reading, error => error === reason);
    assert.equal(canceled, true);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readBody(streamed(new ReadableStream({}), controller.signal)), { name: 'AbortError' });
});

test('body deadline cancels a stalled stream without waiting for its cancel promise', { timeout: 1000 }, async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(readBody(streamed(new ReadableStream({ cancel() { return new Promise<void>(() => {}); } })),
      undefined, { timeoutMs: 10 }), { name: 'TimeoutError' });
  } finally { clearTimeout(keepAlive); }
});
