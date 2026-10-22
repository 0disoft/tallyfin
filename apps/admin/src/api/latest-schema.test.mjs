import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestSchema } from './latest-schema.ts';
const signal = () => new AbortController().signal;
const page = (data, beforeVersion = null) => ({ projectId: 'sample', latestVersion: 5, data, page: { beforeVersion } });
const row = (schemaVersion, schemaStatus = 'active') => ({ schemaVersion, schemaStatus });
test('active metadata avoids scanning retired pages, including no active version', async () => {
  for (const active of [3, null]) {
    let calls = 0;
    const client = { listSchemas: async () => { calls++; return { ...page([row(5, 'retired')], 5), latestActiveVersion: active }; } };
    assert.deepEqual(await latestSchema(client, 'sample', signal()), { active, latest: 5 });
    assert.equal(calls, 1);
  }
});
test('latest active schema scans retired pages and preserves the latest historical version', async () => {
  const calls = [];
  const client = { listSchemas: async (_id, options) => {
    calls.push(options);
    return options.beforeVersion === null ? page([row(5, 'retired'), row(4, 'retired')], 4) : page([row(3), row(2)]);
  } };
  const abort = signal();
  assert.deepEqual(await latestSchema(client, 'sample', abort), { active: 3, latest: 5 });
  assert.deepEqual(calls.map(call => call.beforeVersion), [null, 4]);
  assert.ok(calls.every(call => call.signal === abort && call.limit === 100));
});
test('empty and retired-only schemas stay distinct; failures and cancellation propagate', async () => {
  assert.deepEqual(await latestSchema({ listSchemas: async () => ({ ...page([]), latestVersion: null }) }, 'sample', signal()), { active: null, latest: null });
  assert.deepEqual(await latestSchema({ listSchemas: async () => page([row(5, 'retired')]) }, 'sample', signal()), { active: null, latest: 5 });
  const failure = Error('offline');
  await assert.rejects(latestSchema({ listSchemas: async () => { throw failure; } }, 'sample', signal()), error => error === failure);
  const controller = new AbortController(), reason = Error('cancelled');
  await assert.rejects(latestSchema({ listSchemas: async () => { controller.abort(reason); return page([row(5)]); } }, 'sample', controller.signal), error => error === reason);
});
test('schema scans reject cross-project and non-progressing pages', async () => {
  await assert.rejects(latestSchema({ listSchemas: async () => ({ ...page([row(5)]), projectId: 'other' }) }, 'sample', signal()));
  await assert.rejects(latestSchema({ listSchemas: async () => page([row(5, 'retired')], 5) }, 'sample', signal()));
});
