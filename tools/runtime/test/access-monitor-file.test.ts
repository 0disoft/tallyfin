import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { withMonitorFile } from '../access-monitor-file.ts';
import type { MonitorFiles } from '../access-monitor-file.ts';
import { advanceAccessMonitor } from '../access-monitor.ts';

const path = resolve('in-memory-monitor.json'), uuid = '00000000-0000-4000-8000-000000000001';
const temporary = path + '.' + uuid + '.tmp';
const start = Date.UTC(2026, 9, 22), target = 'a'.repeat(64);
const policy = { failureThreshold: 2, recoveryThreshold: 2, maxGapSeconds: 60 };
const before = advanceAccessMonitor(null, target, policy, false, start).nextState;
const after = advanceAccessMonitor(before, target, policy, false, start + 1000).nextState;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function memory() {
  const data = new Map([[path, bytes(before)]]), calls: string[] = [];
  let hook: (operation: string) => void = () => {};
  const missing = () => Object.assign(Error('missing'), { code: 'ENOENT' });
  const files: MonitorFiles = {
    async mkdir() { calls.push('mkdir'); },
    async lstat(name) {
      if (!data.has(name)) throw missing();
      return { size: data.get(name)!.byteLength, isFile: () => true, isSymbolicLink: () => false };
    },
    async open(name, flags, mode) {
      if (flags === 'wx') {
        assert.equal(mode, 0o600);
        if (data.has(name)) throw Object.assign(Error('exists'), { code: 'EEXIST' });
        data.set(name, new Uint8Array());
      } else if (!data.has(name)) throw missing();
      calls.push('open:' + name);
      if (name === temporary) hook('created');
      return {
        async readFile() { return data.get(name)!.slice(); },
        async writeFile(value) { hook('write'); data.set(name, new TextEncoder().encode(value)); },
        async sync() { hook('sync'); },
        async close() { calls.push('close:' + name); },
      };
    },
    async rename(from, to) { hook('rename'); data.set(to, data.get(from)!); data.delete(from); hook('published'); },
    async unlink(name) { calls.push('unlink:' + name); data.delete(name); },
  };
  return { data, calls, files, setHook(value: typeof hook) { hook = value; } };
}

test('file ports and deterministic UUID publish state with no native I/O', async () => {
  const fs = memory();
  assert.equal(await withMonitorFile(path, async previous => {
    assert.deepEqual(previous, before); return { nextState: after, result: 'published' };
  }, { files: fs.files, uuid: () => uuid }), 'published');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fs.data.get(path))), after);
  assert.deepEqual([...fs.data.keys()], [path]);
  assert.ok(fs.calls.includes('open:' + temporary));
});

test('write, sync and rename failures preserve the old state and release owned files', async () => {
  for (const phase of ['write', 'sync', 'rename']) {
    const fs = memory(), error = Error(phase);
    fs.setHook(operation => { if (operation === phase) throw error; });
    await assert.rejects(withMonitorFile(path, async () => ({ nextState: after, result: true }),
      { files: fs.files, uuid: () => uuid }), failure => failure === error);
    assert.deepEqual(fs.data.get(path), bytes(before)); assert.deepEqual([...fs.data.keys()], [path]);
  }
});

test('cancellation ends an uncooperative observation and its late result cannot publish state', { timeout: 1000 }, async () => {
  const fs = memory(), controller = new AbortController();
  let entered!: () => void, finish!: (value: { nextState: typeof after; result: boolean }) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const observing = withMonitorFile(path, async () => { entered(); return new Promise(resolve => { finish = resolve; }); },
    { files: fs.files, uuid: () => uuid, signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(observing, { name: 'AbortError' });
  assert.deepEqual([...fs.data.keys()], [path]);
  finish({ nextState: after, result: true });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(fs.data.get(path), bytes(before)); assert.deepEqual([...fs.data.keys()], [path]);
});

test('cancellation before rename preserves state, while cancellation after rename reports the committed result', async () => {
  for (const phase of ['created', 'write', 'sync', 'published']) {
    const fs = memory(), controller = new AbortController();
    fs.setHook(operation => { if (operation === phase) controller.abort(); });
    const saving = withMonitorFile(path, async () => ({ nextState: after, result: 'published' }),
      { files: fs.files, uuid: () => uuid, signal: controller.signal });
    if (phase === 'published') {
      assert.equal(await saving, 'published');
      assert.deepEqual(JSON.parse(new TextDecoder().decode(fs.data.get(path))), after);
    } else { await assert.rejects(saving, { name: 'AbortError' }); assert.deepEqual(fs.data.get(path), bytes(before)); }
    assert.deepEqual([...fs.data.keys()], [path]);
  }
  const fs = memory(), controller = new AbortController(); controller.abort();
  await assert.rejects(withMonitorFile(path, async () => ({ nextState: after, result: true }),
    { files: fs.files, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fs.calls.length, 0);
});

test('4096-byte file limit is inclusive and checked before observation', async () => {
  for (const size of [4095, 4096, 4097]) {
    const fs = memory(); let called = false;
    fs.data.set(path, new TextEncoder().encode(JSON.stringify(before).padEnd(size, ' ')));
    const saving = withMonitorFile(path, async () => { called = true; return { nextState: after, result: true }; },
      { files: fs.files, uuid: () => uuid });
    if (size <= 4096) { assert.equal(await saving, true); assert.equal(called, true); }
    else { await assert.rejects(saving, /invalid-monitor-file/); assert.equal(called, false); }
    assert.deepEqual([...fs.data.keys()], [path]);
  }
});
