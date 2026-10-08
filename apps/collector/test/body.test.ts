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
