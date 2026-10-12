import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTallyfinFunnels } from '../src/funnels.ts';
import { FakeBrowser, endpoint } from './helpers.ts';

const plain = { tool: 'loan' };
function disguised(value: string, touched: () => void) {
  return { toString() { touched(); return value; }, toJSON() { touched(); return 'unregistered text 한글'; } };
}

test('standard and funnel clients reject non-string names before coercion or serialization', async () => {
  for (const profile of ['standard', 'funnels']) {
    const host = new FakeBrowser(); let touched = 0;
    const client = profile === 'standard' ? host.client() : createTallyfinFunnels({ endpoint,
      schema: { version: 1, events: { view: {}, first: {}, last: {} },
        funnels: { task: { steps: ['first', 'last'], dimensions: [] } } } }, host);
    const properties = profile === 'standard' ? plain : {};
    for (const name of [disguised('view', () => touched++), new String('view'), null, undefined, Symbol('view')])
      assert.equal(client.track(name as never, properties), false);
    assert.equal(touched, 0); assert.equal(client.pending, 0); assert.equal(host.timers.size, 0);
    assert.equal(client.track('view', properties), true); client.flush(); await host.tick(0);
    const body = host.calls[0]!.body;
    assert.equal(JSON.parse(body).events[0].name, 'view'); assert.equal(Buffer.byteLength(body, 'utf8'), body.length);
    assert.equal(body.includes('unregistered'), false); client.destroy();
  }
});

test('workflow IDs must be primitive strings and cannot inject serialized attempt fields', () => {
  const host = new FakeBrowser(); const client = host.client(); let touched = 0;
  for (const id of [disguised('conversion', () => touched++), new String('conversion'), null, undefined, Symbol('conversion')])
    assert.equal(client.start(id as never, plain), undefined);
  assert.equal(touched, 0); assert.equal(client.pending, 0); assert.equal(host.timers.size, 0);
  assert.ok(client.start('conversion', plain)); client.destroy();
});

test('custom UUID providers cannot replace event or attempt IDs through object conversion', () => {
  for (const path of ['event', 'attempt', 'start-event']) {
    const host = new FakeBrowser(); let touched = 0; let calls = 0;
    const id = crypto.randomUUID();
    host.uuid = () => ++calls === (path === 'start-event' ? 2 : 1)
      ? disguised(id, () => touched++) as unknown as string : id;
    const client = host.client();
    if (path === 'event') assert.equal(client.track('view', plain), false);
    else assert.equal(client.start('conversion', plain), undefined);
    assert.equal(touched, 0); assert.equal(client.pending, 0); assert.equal(host.timers.size, 0); client.destroy();
  }
});

test('non-ASCII public names and properties are rejected; validated numeric and boolean bytes remain ASCII', async () => {
  const host = new FakeBrowser(); const client = host.client();
  assert.equal(client.track('한글', plain), false);
  assert.equal(client.track('view', { tool: '🦄' }), false);
  assert.equal(client.track('view', { 도구: 'loan' }), false);
  assert.equal(client.track('bucket', { flag: true, size: 3 }), true);
  client.flush(); await host.tick(0);
  assert.equal(Buffer.byteLength(host.calls[0]!.body, 'utf8'), host.calls[0]!.body.length);
  client.destroy();
});
