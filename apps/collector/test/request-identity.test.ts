import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollector } from '../src/handler.ts';
import type { CollectionStore } from '@tallyfin/core';

test('injected request identities reach both the error response and observation', async () => {
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const observed: string[] = [];
  const collector = createCollector({} as CollectionStore, { now: () => 0, uuid: () => ids.shift()!,
    observe: entry => observed.push(entry.requestId) });
  for (const expected of [...ids]) {
    const response = await collector(new Request('https://collector.example.invalid/unknown'));
    assert.equal(response.status, 404);
    assert.equal((await response.json() as any).error.requestId, expected);
    assert.equal(observed.at(-1), expected);
  }
  assert.equal(ids.length, 0);
});
