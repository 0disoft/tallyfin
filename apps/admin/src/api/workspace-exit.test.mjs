import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceExit } from './workspace-exit.ts';

test('workspace exit reads the current decision and permits leaving after disposal', () => {
  const exit = new WorkspaceExit(); let allowed = false, calls = 0;
  assert.equal(exit.canLeave(), true);
  const remove = exit.register(() => { calls++; return allowed; });
  assert.equal(exit.canLeave(), false); allowed = true;
  assert.equal(exit.canLeave(), true); assert.equal(calls, 2);
  remove(); remove(); allowed = false;
  assert.equal(exit.canLeave(), true); assert.equal(calls, 2);
});

test('stale cleanup cannot clear a new workspace even when both use the same check', () => {
  const exit = new WorkspaceExit(), check = () => false;
  const old = exit.register(check), current = exit.register(check);
  old(); assert.equal(exit.canLeave(), false);
  const replacement = exit.register(() => true);
  current(); assert.equal(exit.canLeave(), true);
  replacement(); assert.equal(exit.canLeave(), true);
});
