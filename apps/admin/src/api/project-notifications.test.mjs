import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectCreator } from './project-creator.ts';

// Client ports inject UI failures independently of HTTP and authentication.
const broken = () => { throw Error('private UI detail'); };
function fixture(onOpened = () => {}) {
  const calls = { writes: 0, reads: 0 };
  const receipt = { projectId: 'sample', createdAt: '2026-10-12T00:00:00.000Z', creationHash: 'a'.repeat(64) };
  const client = {
    async createProject() { calls.writes++; return receipt; },
    async getSettings() { calls.reads++; return { project: { id: 'sample' }, canEdit: true }; },
  };
  const creator = new ProjectCreator(client, onOpened);
  creator.edit('id', 'sample'); creator.edit('name', 'Sample'); creator.edit('timeZone', 'UTC');
  return { creator, calls, receipt };
}

test('creator: initial and creating notification faults cannot strand the form or skip the write', async () => {
  let opened = 0;
  const { creator, calls } = fixture(() => { opened++; });
  try {
    assert.doesNotThrow(() => creator.subscribe(broken));
    const phases = []; creator.subscribe(state => phases.push(state.phase));
    await assert.doesNotReject(creator.create());
    assert.deepEqual(phases, ['ready', 'creating', 'created', 'opening', 'created']);
    assert.equal(opened, 1); assert.deepEqual(calls, { writes: 1, reads: 1 });
    assert.ok(!JSON.stringify(creator.state).includes('private UI detail'));
  } finally { creator.destroy(); }
});

test('creator: a confirmed creation stays confirmed when its notification throws', async () => {
  let opened = 0;
  const { creator, calls, receipt } = fixture(() => { opened++; });
  try {
    creator.subscribe(state => { if (state.phase === 'created') broken(); });
    await assert.doesNotReject(creator.create());
    assert.equal(creator.state.phase, 'created');
    assert.equal(creator.state.pending, null); assert.deepEqual(creator.state.receipt, receipt);
    assert.equal(opened, 1);
    await creator.create(); await creator.confirm();
    assert.deepEqual(calls, { writes: 1, reads: 1 });
  } finally { creator.destroy(); }
});

test('creator: failed navigation retains the receipt and retries opening without another creation', async () => {
  let attempts = 0;
  const { creator, calls, receipt } = fixture(() => { if (++attempts === 1) broken(); });
  try {
    await assert.doesNotReject(creator.create());
    assert.equal(creator.state.phase, 'created'); assert.deepEqual(creator.state.receipt, receipt);
    assert.match(creator.state.message, /화면을 열지 못/);
    assert.ok(!creator.state.message.includes('private UI detail'));
    await creator.open();
    assert.equal(attempts, 2); assert.deepEqual(calls, { writes: 1, reads: 2 });
  } finally { creator.destroy(); }
});

for (const phase of ['creating', 'opening']) {
  test(`creator: disposal during ${phase} notification cancels the next request and subsequent callbacks`, async () => {
    const { creator, calls } = fixture(broken);
    let later = 0;
    creator.subscribe(state => { if (state.phase === phase) creator.destroy(); });
    creator.subscribe(state => { if (state.phase === phase) later++; });
    await assert.doesNotReject(creator.create());
    creator.subscribe(() => { later++; });
    assert.equal(later, 0);
    assert.deepEqual(calls, { writes: phase === 'creating' ? 0 : 1, reads: 0 });
  });
}
