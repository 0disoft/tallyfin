import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { advanceAccessMonitor, monitorPolicy, monitorState } from '../access-monitor.ts';
import { withMonitorFile } from '../access-monitor-file.ts';

const target = 'a'.repeat(64), policy = { failureThreshold: 2, recoveryThreshold: 2, maxGapSeconds: 60 };
const start = Date.UTC(2026, 9, 21);
test('failure and recovery thresholds emit one transition intent while continuing to report the current incident', () => {
  let state: unknown = null, now = start;
  const events: string[] = [], notifications: boolean[] = [];
  for (const passed of [true, false, false, false, true, false, true, true, true]) {
    const next = advanceAccessMonitor(state, target, policy, passed, now += 1000);
    state = next.nextState; events.push(next.event); notifications.push(next.notify);
    assert.deepEqual(monitorState(state, target, policy), state);
  }
  assert.deepEqual(events, ['healthy', 'failure_pending', 'incident_opened', 'incident_ongoing', 'recovery_pending',
    'incident_ongoing', 'recovery_pending', 'incident_resolved', 'healthy']);
  assert.deepEqual(notifications, [false, false, true, false, false, false, false, true, false]);
});
test('gaps reset streaks without silently closing an incident or confirming a recovery', () => {
  const failed = advanceAccessMonitor(null, target, policy, false, start);
  const stale = advanceAccessMonitor(failed.nextState, target, policy, false, start + 61000);
  assert.equal(stale.event, 'failure_pending'); assert.equal(stale.sampleGapExceeded, true);
  const open = advanceAccessMonitor(stale.nextState, target, policy, false, start + 62000);
  const one = advanceAccessMonitor(open.nextState, target, policy, true, start + 63000);
  const gap = advanceAccessMonitor(one.nextState, target, policy, true, start + 124000);
  assert.equal(gap.event, 'recovery_pending'); assert.equal(gap.nextState.consecutivePasses, 1);
  assert.equal(gap.nextState.incidentOpen, true); assert.equal(gap.notify, false);
  assert.equal(advanceAccessMonitor(gap.nextState, target, policy, true, start + 125000).event, 'incident_resolved');
  const boundary = advanceAccessMonitor(failed.nextState, target, policy, false, start + 60000);
  assert.equal(boundary.event, 'incident_opened'); assert.equal(boundary.sampleGapExceeded, false);
});
test('target/policy mismatches, malformed state, impossible counters and clock rollback cannot reset history', () => {
  const state = advanceAccessMonitor(null, target, policy, false, start).nextState;
  for (const invalid of [[], {}, { ...state, token: 'private-marker' }, { ...state, targetFingerprint: 'b'.repeat(64) },
    { ...state, consecutiveFailures: 2 }, { ...state, consecutivePasses: 1 }, { ...state, checkedAt: 'bad' },
    { ...state, policy: { ...policy, recoveryThreshold: 3 } }, { ...state, consecutiveFailures: NaN }])
    assert.throws(() => advanceAccessMonitor(invalid, target, policy, true, start + 1000));
  for (const now of [start, start - 1, NaN, Infinity]) assert.throws(() => advanceAccessMonitor(state, target, policy, true, now));
  for (const invalid of [{ ...policy, failureThreshold: 0 }, { ...policy, recoveryThreshold: 101 },
    { ...policy, maxGapSeconds: 86401 }, { ...policy, maxGapSeconds: 1.5 }, { ...policy, secret: 'private-marker' }])
    assert.throws(() => monitorPolicy(invalid));
  const immediate = advanceAccessMonitor(null, target, { ...policy, failureThreshold: 1 }, false, start);
  assert.equal(immediate.event, 'incident_opened');
});

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-monitor-'));
  try { await run(directory); } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  }
}
test('state publication is exclusive and a failed observation preserves the previous file', async () => temporary(async directory => {
  const path = join(directory, 'state.json'), state = advanceAccessMonitor(null, target, policy, false, start).nextState;
  await withMonitorFile(path, async previous => { assert.equal(previous, null); return { nextState: state, result: true }; });
  const original = await readFile(path, 'utf8');
  await assert.rejects(withMonitorFile(path, async () => { throw Error('fixture failure'); }));
  assert.equal(await readFile(path, 'utf8'), original);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const first = withMonitorFile(path, async () => { entered(); await gate; return { nextState: state, result: true }; });
  await ready;
  try {
    let called = false;
    await assert.rejects(withMonitorFile(path, async () => { called = true; return { nextState: state, result: false }; }), { code: 'EEXIST' });
    assert.equal(called, false);
  } finally { release(); await first; }
  assert.deepEqual(await readdir(directory), ['state.json']);
}));
test('corrupt, null and oversized files fail before the observation callback', async () => temporary(async directory => {
  const path = join(directory, 'state.json');
  for (const bytes of ['{', 'null', ' '.repeat(4097), Buffer.from([0xff])]) {
    await writeFile(path, bytes); let called = false;
    await assert.rejects(withMonitorFile(path, async () => { called = true; throw Error(); }));
    assert.equal(called, false); assert.deepEqual(await readdir(directory), ['state.json']);
  }
}));
