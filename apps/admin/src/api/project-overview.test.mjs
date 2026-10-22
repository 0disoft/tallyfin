import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './client.ts';
import { projectOverview } from './project-overview.ts';
const projects = Array.from({ length: 5 }, (_, n) => ({ id: `service-${n}`, name: `Service ${n}`, timeZone: 'Asia/Seoul', status: 'active' }));
const now = new Date('2026-10-23T00:00:00Z');
function fixture() {
  let active = 0, maximum = 0;
  const calls = [];
  const client = {
    async listSchemas(id, options) {
      calls.push([id, 'schema', options]); active++; maximum = Math.max(maximum, active);
      try { await new Promise(resolve => setTimeout(resolve, 1)); return { projectId: id, latestVersion: 1, data: [{ schemaVersion: 1, schemaStatus: 'active' }], page: { beforeVersion: null } }; }
      finally { active--; }
    },
    async getSchema(id) { return { project: projects.find(p => p.id === id), schemaVersion: 1, events: [{ name: 'view', source: 'browser' }], workflows: [] }; },
    async getSummary(id, options) { calls.push([id, 'summary', options]); return { meta: { projectId: id, schemaVersion: 1, source: options.source, ...options,
      timeZone: 'Asia/Seoul', generatedAt: now.toISOString(), latestReceivedAt: null, coverage: 'observed-only' }, totalEvents: 0, events: [{ name: 'view', count: 0 }] }; },
    async getWorkflowDaily() { throw Error('no registered workflow'); },
    async getCollectionRejections() { return { summary: { rejectedRequests: 0 } }; },
  };
  return { client, calls, maximum: () => maximum };
}
test('service overview reads only five visible projects with two workers, stable order and explicit zero counts', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const rows = await projectOverview(f.client, projects, 'browser', signal, now);
  assert.deepEqual(rows.map(row => row.project.id), projects.map(project => project.id));
  assert.equal(f.maximum(), 2); assert.ok(rows.every(row => row.events === 0 && row.rejected === 0 && row.completion === null));
  assert.ok(f.calls.every(([, , options]) => options.signal === signal));
  assert.equal(f.calls.filter(([, kind]) => kind === 'summary').length, 10);
  await assert.rejects(projectOverview(f.client, [...projects, { ...projects[0], id: 'extra' }], 'browser', signal, now), RangeError);
  await assert.rejects(projectOverview(f.client, [projects[0], projects[0]], 'browser', signal, now), RangeError);
});
test('failed permissions clear a row and do not turn unknown data into zeros or fail other services', async () => {
  const f = fixture(), original = f.client.getSummary;
  f.client.getSummary = async (id, options) => { if (id === projects[0].id) throw new ApiError('forbidden', 'denied', 403); return original(id, options); };
  const rows = await projectOverview(f.client, projects, 'browser', new AbortController().signal, now);
  assert.equal(rows[0].error, true); assert.equal(rows[0].events, null); assert.equal(rows[1].events, 0);
  f.client.listSchemas = async id => ({ projectId: id, latestVersion: null, data: [], page: { beforeVersion: null } });
  const empty = await projectOverview(f.client, [projects[0]], 'browser', new AbortController().signal, now);
  assert.equal(empty[0].version, null); assert.equal(empty[0].events, null); assert.equal(empty[0].error, undefined);
});
test('cancellation preserves its exact reason and starts no later service reads', async () => {
  const f = fixture(), controller = new AbortController(), reason = Error('page changed');
  f.client.listSchemas = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(projectOverview(f.client, projects, 'browser', controller.signal, now), error => error === reason);
  assert.equal(f.calls.length, 0);
});
