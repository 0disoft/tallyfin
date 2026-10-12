import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftExitGuard } from './draft-exit-guard.ts';

test('exit checks are live, scoped and combine editors into one confirmation', () => {
  const guard = new DraftExitGuard(), client = {}, other = {};
  let settings = false, schema = false, confirmations = 0;
  const cancel = () => { confirmations++; return false; };
  const first = guard.register(client, 'one', () => settings);
  const second = guard.register(client, 'one', () => schema);
  assert.equal(guard.canLeave(client, 'one', cancel), true);
  settings = schema = true;
  assert.equal(guard.canLeave(other, 'one', cancel), true);
  assert.equal(guard.canLeave(client, 'two', cancel), true);
  assert.equal(guard.canLeave(client, null, cancel), true);
  assert.equal(confirmations, 0);
  assert.equal(guard.canLeave(client, 'one', cancel), false);
  assert.equal(confirmations, 1);
  first(); first();
  assert.equal(guard.canLeave(client, 'one', () => true), true);
  assert.equal(guard.canLeave(client, 'one', cancel), false);
  schema = false;
  assert.equal(guard.canLeave(client, 'one', cancel), true);
  second();
});

test('late old registration cleanup cannot remove a replacement or another scope', () => {
  const guard = new DraftExitGuard(), client = {}, newClient = {};
  const stale = guard.register(client, 'one', () => true);
  const current = guard.register(client, 'one', () => true);
  const other = guard.register(newClient, 'one', () => true);
  stale();
  assert.equal(guard.canLeave(client, 'one', () => false), false);
  current();
  assert.equal(guard.canLeave(client, 'one', () => false), true);
  assert.equal(guard.canLeave(newClient, 'one', () => false), false);
  other();
  assert.equal(guard.canLeave(newClient, 'one', () => false), true);
});
