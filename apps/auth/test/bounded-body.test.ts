import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthBody } from '../src/bounded-body.ts';

test('accepts empty input and 16383/16384-byte chunked boundaries without cancellation', async () => {
  for (const size of [0, 16383, 16384]) {
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (size) { controller.enqueue(new Uint8Array(size - 1).fill(7)); controller.enqueue(Uint8Array.of(9)); }
        controller.close();
      },
      cancel() { cancellations++; },
    });
    const result = await readAuthBody(body, new AbortController().signal);
    assert.equal(result.length, size);
    if (size) { assert.equal(result[0], 7); assert.equal(result[size - 1], 9); }
    assert.equal(cancellations, 0); assert.equal(body.locked, false);
  }
});

test('overflow rejects before a stalled cancel settles and releases the reader lock', async () => {
  let finishCancel!: () => void, cancellations = 0;
  const held = new Promise<void>(resolve => { finishCancel = resolve; });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(16385)); },
    cancel() { cancellations++; return held; },
  });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const pending = readAuthBody(body, new AbortController().signal);
  try {
    await assert.rejects(Promise.race([pending, new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(Error('Still waiting for transport cancellation')), 1000);
    })]), { name: 'RangeError', message: 'Request too large' });
    assert.equal(cancellations, 1); assert.equal(body.locked, false);
  } finally { clearTimeout(watchdog); finishCancel(); await pending.catch(() => {}); }
});

test('a rejected cancel cannot replace the overflow error', async () => {
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(16385)); },
    cancel() { cancellations++; return Promise.reject(Error('Transport cleanup failed')); },
  });
  await assert.rejects(readAuthBody(body, new AbortController().signal), { name: 'RangeError', message: 'Request too large' });
  assert.equal(cancellations, 1); assert.equal(body.locked, false);
});

test('an already aborted request cancels unread input once and preserves its cause', async () => {
  const controller = new AbortController(), cause = Error('Request canceled'); controller.abort(cause);
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancellations++; } });
  await assert.rejects(readAuthBody(body, controller.signal), error => error === cause);
  assert.equal(cancellations, 1); assert.equal(body.locked, false);
});

test('abort during a pending read completes without waiting for transport cleanup', async () => {
  const controller = new AbortController(), cause = Error('Body deadline expired');
  let finishCancel!: () => void, cancellations = 0;
  const held = new Promise<void>(resolve => { finishCancel = resolve; });
  const body = new ReadableStream<Uint8Array>({ cancel() { cancellations++; return held; } });
  const pending = readAuthBody(body, controller.signal);
  controller.abort(cause);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(Promise.race([pending, new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(Error('Still waiting after abort')), 1000);
    })]), error => error === cause);
    assert.equal(cancellations, 1); assert.equal(body.locked, false);
  } finally { clearTimeout(watchdog); finishCancel(); await pending.catch(() => {}); }
});

test('a read error preserves its cause and releases the reader', async () => {
  const cause = Error('Request stream failed');
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(cause); } });
  await assert.rejects(readAuthBody(body, new AbortController().signal), error => error === cause);
  assert.equal(body.locked, false);
});
