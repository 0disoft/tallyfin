import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeyFetchGate } from '../src/key-fetch-gate.ts';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
test('key slots and waiters are bounded, canceled waits are removed, and failures release capacity', async () => {
  const gate = createKeyFetchGate(1, 1), held = deferred(), entered = deferred();
  const signal = new AbortController().signal;
  const first = gate(signal, async () => { entered.resolve(); await held.promise; return 1; });
  await entered.promise;
  const controller = new AbortController(); let ran = false;
  const canceled = gate(controller.signal, async () => { ran = true; return 2; });
  await assert.rejects(gate(signal, async () => 3), /capacity exceeded/);
  controller.abort(); await assert.rejects(canceled, { name: 'AbortError' });
  const next = gate(signal, async () => { throw Error('fetch failed'); });
  const checked = assert.rejects(next, /fetch failed/);
  held.resolve(); assert.equal(await first, 1); await checked;
  assert.equal(ran, false); assert.equal(await gate(signal, async () => 4), 4);
});
