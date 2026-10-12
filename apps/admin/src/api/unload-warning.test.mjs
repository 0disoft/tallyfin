import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installUnloadWarning } from '../useUnloadWarning.ts';

test('unload warning cancels the event only while its listener is installed', () => {
  const target = new EventTarget();
  const event = () => new Event('beforeunload', { cancelable: true });
  assert.equal(target.dispatchEvent(event()), true);
  const remove = installUnloadWarning(target);
  assert.equal(target.dispatchEvent(event()), false);
  remove(); remove();
  assert.equal(target.dispatchEvent(event()), true);
});

test('cleaning up one editor cannot remove another editor unload warning', () => {
  const target = new EventTarget();
  const first = installUnloadWarning(target), second = installUnloadWarning(target);
  first();
  assert.equal(target.dispatchEvent(new Event('beforeunload', { cancelable: true })), false);
  second();
  assert.equal(target.dispatchEvent(new Event('beforeunload', { cancelable: true })), true);
});
