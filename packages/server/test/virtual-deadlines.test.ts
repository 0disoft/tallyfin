import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createTallyfinServer } from '../src/index.ts';
import type { ServerPlatform } from '../src/index.ts';

const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
class Clock {
  elapsed = 0; nextId = 0;
  tasks = new Map<number, { at: number; callback: () => void }>();
  timer(callback: () => void, ms: number) {
    const id = ++this.nextId; this.tasks.set(id, { at: this.elapsed + ms, callback });
    return () => { this.tasks.delete(id); };
  }
  async tick(ms: number) {
    this.elapsed += ms;
    for (const [id, task] of [...this.tasks]) if (task.at <= this.elapsed) { this.tasks.delete(id); task.callback(); }
    await drain();
  }
}

for (const minified of [false, true]) test(`${minified ? 'minified' : 'source'}: host timers control every deadline without wall-clock sleeps`, async () => {
  let create = createTallyfinServer;
  if (minified) {
    const result = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
      bundle: true, write: false, minify: true, format: 'esm', platform: 'neutral', target: 'es2023' });
    create = (await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0]!.text).toString('base64'))).createTallyfinServer;
  }
  for (const phase of ['credential', 'request', 'body', 'wait', 'success']) {
    const clock = new Clock(); let canceled = false, provider!: AbortSignal, requestSignal!: AbortSignal;
    const host: ServerPlatform = {
      now: () => Date.UTC(2026, 9, 22), monotonicNow: () => clock.elapsed,
      uuid: () => '00000000-0000-4000-8000-000000000001',
      timer: clock.timer.bind(clock), wait: async () => new Promise<void>(() => {}),
      fetch: async (_url, init) => {
        requestSignal = init!.signal as AbortSignal;
        if (phase === 'request') return new Promise<Response>(() => {});
        if (phase === 'wait') return new Response(null, { status: 503 });
        if (phase === 'body') return new Response(new ReadableStream({
          cancel() { canceled = true; return new Promise<void>(() => {}); },
        }), { headers: { 'Content-Type': 'application/json' } });
        return Response.json({ accepted: 1, duplicates: 0 });
      },
    };
    const client = create({ endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
      schema: { version: 1, events: { done: {} } }, maxAttempts: phase === 'wait' ? 2 : 1,
      requestTimeoutMs: 10, retryBudgetMs: 2000,
      getToken: signal => { provider = signal; return phase === 'credential' ? new Promise<string>(() => {}) : 'test-only'; },
    }, host);
    let settled = false;
    const sending = client.send([client.createEvent('done')]).then(result => { settled = true; return result; });
    await drain();
    if (phase === 'success') assert.equal((await sending).status, 'delivered');
    else {
      await clock.tick(phase === 'wait' ? 1999 : 9); assert.equal(settled, false);
      await clock.tick(1);
      const result = await sending;
      assert.equal(result.status, 'unavailable');
      if (result.status !== 'delivered') assert.equal(result.reason, phase === 'wait' ? 'retry_deferred' :
        phase === 'credential' ? 'authentication_unavailable' : 'transport_unavailable');
      assert.equal(provider.aborted, true);
      if (phase !== 'credential') assert.equal(requestSignal.aborted, true);
      if (phase === 'body') assert.equal(canceled, true);
    }
    assert.equal(clock.tasks.size, 0);
  }
});
