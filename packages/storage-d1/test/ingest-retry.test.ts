import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingestRetryDelay, waitForIngestRetry } from '../src/ingest-retry.ts';

test('jitter grows exponentially, caps at 250ms and rejects invalid randomness', () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => ingestRetryDelay(i, () => 0.5)), [10,20,40,80,125,125,125]);
  assert.equal(Array.from({ length: 7 }, (_, i) => ingestRetryDelay(i, () => 0.999999)).reduce((a,b) => a+b, 0), 1050);
  for (const n of [-0.1, 1, NaN, Infinity]) assert.throws(() => ingestRetryDelay(0, () => n), TypeError);
});

test('retry waits release their abort listener after both completion and cancellation', async t => {
  for (const cancel of [false,true]) {
    const controller = new AbortController(), signal = controller.signal;
    const add = t.mock.method(signal, 'addEventListener');
    const remove = t.mock.method(signal, 'removeEventListener');
    const pending = waitForIngestRetry(0, { signal, random: () => cancel ? 0.99 : 0 });
    const reason = Error('cancelled');
    if (cancel) { controller.abort(reason); await assert.rejects(pending, e => e === reason); }
    else await pending;
    assert.equal(add.mock.callCount(), 1); assert.equal(remove.mock.callCount(), 1);
    assert.equal(add.mock.calls[0]!.arguments[1], remove.mock.calls[0]!.arguments[1]);
  }
});
