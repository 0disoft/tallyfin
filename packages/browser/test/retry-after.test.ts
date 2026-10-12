import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfinFunnels } from '../src/funnels.ts';
import { endpoint, FakeBrowser } from './helpers.ts';

const profiles = {
  workflow: (host: FakeBrowser) => host.client(),
  funnel: (host: FakeBrowser) => createTallyfinFunnels({ endpoint, schema: {
    version: 1, events: { view: { tool: ['enum', true, ['loan', 'timer']] }, first: {}, last: {} },
    funnels: { task: { steps: ['first', 'last'], dimensions: [] } },
  } }, host),
};

for (const [profile, create] of Object.entries(profiles)) {
  test(`${profile}: HTTP-date Retry-After survives flush and hidden callbacks with unchanged bytes`, async () => {
    for (const status of [429, 503]) {
      const host = new FakeBrowser(); const until = new Date(host.time + 60000).toUTCString();
      host.reply = async index => ({ status: index === 0 ? status : 200, retryAfter: until });
      const client = create(host);
      try {
        assert.equal(client.track('view', { tool: 'loan' }), true); client.flush(); await host.tick(0);
        client.track('view', { tool: 'timer' }); host.beaconResult = true; host.hidden(); client.flush();
        await host.tick(59999);
        assert.equal(host.calls.length, 1); assert.equal(host.beacons.length, 0); assert.equal(client.pending, 2);
        await host.tick(1);
        assert.equal(host.calls.length, 3); assert.equal(host.calls[1]!.body, host.calls[0]!.body);
        assert.equal(client.pending, 0); assert.equal(host.timers.size, 0);
      } finally { client.destroy(); }
    }
  });

  test(`${profile}: HTTP dates at or beyond the batch deadline release memory without retry`, async () => {
    for (const delay of [600000, 86400000]) {
      const host = new FakeBrowser();
      host.reply = async () => ({ status: 429, retryAfter: new Date(host.time + delay).toUTCString() });
      const client = create(host);
      try {
        client.track('view', { tool: 'loan' }); client.flush(); await host.tick(0);
        assert.equal(client.pending, 0); assert.equal(host.timers.size, 0);
        await host.tick(600001); assert.equal(host.calls.length, 1);
      } finally { client.destroy(); }
    }
  });

  test(`${profile}: past dates use the one-second floor and malformed dates retain exponential backoff`, async () => {
    const reference = new FakeBrowser().time;
    for (const header of [new Date(reference - 60000).toUTCString(), 'not a date', '2026-10-08T15:01:15Z',
      'Thu, 30 Feb 2026 15:01:15 GMT', 'Thu, 08 Oct 2026 25:01:15 GMT', 'Fri, 08 Oct 2026 15:01:15 GMT']) {
      const host = new FakeBrowser(); host.reply = async () => ({ status: 503, retryAfter: header });
      const client = create(host);
      try {
        client.track('view', { tool: 'loan' }); client.flush(); await host.tick(999);
        assert.equal(host.calls.length, 1); await host.tick(1); assert.equal(host.calls.length, 2);
        const delay = header === new Date(reference - 60000).toUTCString() ? 1000 : 2000;
        await host.tick(delay - 1); assert.equal(host.calls.length, 2);
        await host.tick(1); assert.equal(host.calls.length, 3); assert.equal(client.pending, 0);
        assert.equal(host.timers.size, 0);
      } finally { client.destroy(); }
    }
  });
}
