import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionWorkflow } from '../src/workflow-transition.ts';

const workflow = { id: 'task', phase: 'success' as const, attemptId: 'test-attempt', schemaVersion: 1,
  startedAt: 1000, cohortDate: '2026-10-22', dimensionKey: '[]' };

test('pending terminal, delayed start and duplicate phases preserve borrowed states', () => {
  const terminal = transitionWorkflow(workflow, 2000, undefined);
  assert.equal(terminal.delta, null);
  const previous = Object.freeze(terminal.state);
  const started = transitionWorkflow({ ...workflow, phase: 'start' }, 1000, previous);
  assert.deepEqual(started.delta, [1, 1, 0]);
  assert.equal(previous.start_seen, 0); assert.equal(started.state.start_seen, 1);
  const original = Object.freeze(started.state);
  const repeated = transitionWorkflow(workflow, 3000, original);
  assert.equal(repeated.duplicate, true); assert.equal(repeated.delta, null);
  assert.equal(repeated.state.terminal_at, 2000); assert.notEqual(repeated.state, original);
  assert.throws(() => transitionWorkflow({ ...workflow, phase: 'failure' }, 3000, original), { code: 'attempt_conflict' });
  assert.equal(original.terminal_kind, 'success');
});

test('a normal start/terminal transition counts once and rejects a changed attempt definition', () => {
  const started = transitionWorkflow({ ...workflow, phase: 'start' }, 1000, undefined);
  assert.deepEqual(started.delta, [1, 0, 0]);
  const ended = transitionWorkflow(workflow, 2000, Object.freeze(started.state));
  assert.deepEqual(ended.delta, [0, 1, 0]);
  assert.equal(started.state.terminal_kind, null);
  assert.throws(() => transitionWorkflow({ ...workflow, schemaVersion: 2 }, 2000, started.state), { code: 'attempt_conflict' });
});
