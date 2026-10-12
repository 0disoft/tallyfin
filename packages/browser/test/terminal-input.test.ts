import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBatch } from '../../core/src/batch.ts';
import { FakeBrowser } from './helpers.ts';

for (const phase of ['succeed', 'fail'] as const) {
  test(`${phase}: malformed properties cannot consume the handle or emit a terminal`, async () => {
    const host = new FakeBrowser(); const client = host.client();
    try {
      const attempt = client.start('conversion', { tool: 'loan' })!;
      assert.ok(attempt);
      for (const value of [null, [], Object.assign([], { tool: 'loan' }), '', 0, false, () => {}]) {
        assert.equal(attempt[phase](value as never), false);
        assert.equal(client.pending, 1);
      }
      assert.equal(attempt[phase]({}), true);
      assert.equal(attempt[phase](), false);
      client.flush(); await host.tick(0);
      const batch = parseBatch(host.calls[0]!.body);
      assert.deepEqual(batch.events.map(event => event.name), ['started', phase === 'succeed' ? 'succeeded' : 'failed']);
      assert.deepEqual(batch.events[1]!.properties, { tool: 'loan' });
      assert.deepEqual(batch.events[1]!.attempt, batch.events[0]!.attempt);
    } finally { client.destroy(); }
  });
}

test('terminal properties are read once and a rejected getter leaves the handle usable', async () => {
  const host = new FakeBrowser(); const client = host.client(); let reads = 0;
  try {
    const attempt = client.start('conversion', { tool: 'loan' })!;
    assert.equal(attempt.succeed({ get tool(): string { throw Error('unreadable'); } }), false);
    assert.equal(client.pending, 1);
    assert.equal(attempt.succeed({ get tool() { reads++; return 'loan'; } }), true);
    assert.equal(reads, 1);
    client.flush(); await host.tick(0);
    assert.deepEqual(parseBatch(host.calls[0]!.body).events[1]!.properties, { tool: 'loan' });
  } finally { client.destroy(); }
});
