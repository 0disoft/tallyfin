import { createTallyfin } from '../src/index.ts';
import type { BrowserPlatform, BrowserSchema } from '../src/index.ts';
export const schema: BrowserSchema = {
  version: 1,
  events: {
    view: { tool: ['enum', true, ['loan', 'timer']] },
    started: { tool: ['enum', true, ['loan', 'timer']] },
    succeeded: { tool: ['enum', true, ['loan', 'timer']] },
    failed: { tool: ['enum', true, ['loan', 'timer']] },
    validation: { tool: ['enum', true, ['loan', 'timer']], code: ['enum', false, ['required', 'range']] },
    bucket: { flag: ['boolean', true], size: ['integer', false, 1, 3] },
  },
  workflows: { conversion: { start: 'started', success: 'succeeded', failure: 'failed', dimensions: ['tool'] } },
};
export const endpoint = 'https://collector.example.invalid/v1/projects/example/batches';
export type Reply = { status: number; retryAfter: string | null };
export class FakeBrowser implements BrowserPlatform {
  time = Date.parse('2026-10-08T15:00:15Z');
  timers = new Map<number, { at: number; callback: () => void }>();
  listeners = new Set<() => void>();
  calls: { endpoint: string; body: string; signal: AbortSignal }[] = [];
  beacons: string[] = [];
  beaconResult = false;
  nextId = 0;
  reply: (index: number) => Promise<Reply> = () => Promise.resolve({ status: 200, retryAfter: null });
  now = () => this.time;
  monotonicNow = () => this.time;
  uuid = () => crypto.randomUUID();
  timer = (callback: () => void, milliseconds: number) => {
    const id = ++this.nextId; this.timers.set(id, { at: this.time + milliseconds, callback });
    return () => { this.timers.delete(id); };
  };
  send = (endpoint: string, body: string, signal: AbortSignal) => {
    this.calls.push({ endpoint, body, signal }); return this.reply(this.calls.length - 1);
  };
  beacon = (_endpoint: string, body: string) => { this.beacons.push(body); return this.beaconResult; };
  onHidden = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  hidden() { for (const callback of this.listeners) callback(); }
  async tick(milliseconds: number) {
    const until = this.time + milliseconds;
    for (let guard = 0; guard < 1000; guard++) {
      // Drain microtasks before selecting the next timer so settled network responses can cancel timeouts.
      for (let count = 0; count < 6; count++) await Promise.resolve();
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= until);
      if (!next) { this.time = until; return; }
      this.time = Math.max(this.time, next[1].at); this.timers.delete(next[0]); next[1].callback();
    }
    throw Error('unexpected infinite timer loop');
  }
  client(configuration = schema) { return createTallyfin({ endpoint, schema: configuration }, this); }
}
export function deferred() {
  let resolve!: (reply: Reply) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Reply>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
