import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createTallyfinServer } from '../src/index.ts';
import type { ServerPlatform } from '../src/index.ts';

for (const minified of [false, true]) test(`${minified ? 'minified' : 'source'} propagates the caller reason through every delivery phase without exposing it`, async () => {
  const create: typeof createTallyfinServer = minified ? (await import('data:text/javascript;base64,' + Buffer.from((await build({
    entryPoints: ['packages/server/src/index.ts'], bundle: true, write: false, minify: true,
    format: 'esm', platform: 'neutral', target: 'es2023',
  })).outputFiles[0]!.text).toString('base64'))).createTallyfinServer : createTallyfinServer;
  for (const phase of ['credential', 'request', 'body', 'wait']) {
    const caller = new AbortController(), reason = new Error('private caller cancellation');
    let entered!: () => void, current!: AbortSignal, canceled = 0, calls = 0, timers = 0;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const stopHere = (signal: AbortSignal) => { current = signal; entered(); return new Promise<never>(() => {}); };
    const host: ServerPlatform = {
      now: () => Date.UTC(2026, 9, 23), monotonicNow: () => 0, uuid: () => '00000000-0000-4000-8000-000000000001',
      timer: () => { timers++; return () => { timers--; }; },
      wait: async (_delay, signal) => stopHere(signal),
      fetch: async (_url, init) => {
        calls++;
        if (phase === 'request') return stopHere(init!.signal!);
        if (phase === 'wait') return new Response(null, { status: 503 });
        current = init!.signal!;
        return new Response(new ReadableStream({ start() { entered(); },
          cancel() { canceled++; return new Promise<void>(() => {}); },
        }), { headers: { 'Content-Type': 'application/json' } });
      },
    };
    const client = create({ endpoint: 'https://collector.example.invalid/v1/projects/jobs/server-batches',
      schema: { version: 1, events: { done: {} } }, maxAttempts: 2,
      getToken: signal => phase === 'credential' ? stopHere(signal) : 'test-only-credential',
    }, host);
    const sending = client.send([client.createEvent('done')], { signal: caller.signal });
    await ready;
    // Let the response body acquire its reader before aborting that phase.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    caller.abort(reason);
    const result = await sending;
    assert.equal(current.reason, reason); assert.equal(current.aborted, true);
    assert.equal(result.status, 'aborted'); assert.equal(result.attempts, phase === 'credential' ? 0 : 1);
    assert.equal(calls, phase === 'credential' ? 0 : 1); assert.equal(timers, 0);
    if (phase === 'body') assert.equal(canceled, 1);
    assert.ok(!JSON.stringify(result).includes(reason.message));
  }
});
