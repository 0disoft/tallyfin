import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfin } from '../src/index.ts';
import { FakeBrowser, schema, endpoint } from './helpers.ts';
import type { DeliveryState } from '../src/types.ts';

test('delivery diagnostics distinguish HTTP acceptance, retry exhaustion, overflow and explicit destruction', async () => {
  const host = new FakeBrowser(), records: [DeliveryState, number][] = [];
  const client = createTallyfin({ schema, endpoint, onDelivery: (state, count) => records.push([state, count]) }, host);
  assert.equal(client.track('view', { tool: 'loan' }), true); client.flush(); await host.tick(0);
  assert.deepEqual(records, [['accepted', 1]]);
  host.reply = async () => ({ status: 503, retryAfter: null });
  client.track('view', { tool: 'loan' }); client.flush(); await host.tick(3000);
  assert.deepEqual(records.slice(1), [['retry', 1], ['retry', 1], ['failed', 1]]);
  for (let n = 0; n < 40; n++) assert.equal(client.track('view', { tool: 'loan' }), true);
  assert.equal(client.track('view', { tool: 'loan' }), false);
  client.destroy(); assert.deepEqual(records.slice(-2), [['overflow', 1], ['destroyed', 40]]);
  assert.equal(host.timers.size, 0); assert.equal(host.listeners.size, 0);
});
test('diagnostic exceptions and reentrant calls cannot alter successful delivery or recurse forever', async () => {
  const host = new FakeBrowser(); let observed = 0;
  const client = createTallyfin({ schema, endpoint, onDelivery: () => { observed++; throw Error('private observer failure'); } }, host);
  client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
  assert.equal(observed, 1); assert.equal(client.pending, 0); client.destroy();
  let calls = 0;
  const full = createTallyfin({ schema, endpoint, onDelivery: () => { calls++; full.track('view', { tool: 'loan' }); } }, host);
  for (let n = 0; n < 40; n++) full.track('view', { tool: 'loan' });
  assert.equal(full.track('view', { tool: 'loan' }), false); assert.equal(calls, 1); full.destroy();
});
test('host beacon acceptance is not labelled as a server acknowledgement', () => {
  const host = new FakeBrowser(); host.beaconResult = true;
  const records: [DeliveryState, number][] = [];
  const client = createTallyfin({ schema, endpoint, onDelivery: (state, count) => records.push([state, count]) }, host);
  client.track('view', { tool: 'loan' }); host.hidden();
  assert.deepEqual(records, [['beacon_queued', 1]]); client.destroy();
});
