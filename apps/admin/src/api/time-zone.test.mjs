import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from './client.ts';

const project = timeZone => ({ id: 'sembom', name: 'Sembom', status: 'active', timeZone });
const meta = timeZone => ({ projectId: 'sembom', schemaVersion: 1, source: 'browser',
  from: '2026-10-11', to: '2026-10-12', timeZone, generatedAt: '2026-10-12T00:00:00Z',
  latestReceivedAt: null, coverage: 'observed-only' });
const clientFor = body => new ApiClient({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }) });

test('project list rejects invalid time zones before the dashboard can format dates', async () => {
  for (const zone of ['Mars/Olympus', '', ' Asia/Seoul', '+09:00', 'a'.repeat(65)]) {
    const client = clientFor({ data: [project(zone)], page: { limit: 25, nextCursor: null } });
    try { await assert.rejects(client.listProjects(), error => error.kind === 'contract'); }
    finally { client.destroy(); }
  }
});

test('project list preserves supported zone names and aliases without rewriting them', async () => {
  for (const zone of ['UTC', 'Asia/Seoul', 'America/New_York', 'Etc/GMT+5', 'US/Eastern']) {
    const client = clientFor({ data: [project(zone)], page: { limit: 25, nextCursor: null } });
    try { assert.equal((await client.listProjects()).data[0].timeZone, zone); }
    finally { client.destroy(); }
  }
});

test('schema and analytics responses reject unsupported zones at the API boundary', async () => {
  const bodies = [
    { project: project('Mars/Olympus'), schemaVersion: 1, schemaStatus: 'active', allowedOrigins: [],
      limits: { requestsPerMinute: 120, newReceiptsPerUtcDay: 100000 }, events: [], workflows: [] },
    { meta: meta('Mars/Olympus'), totalEvents: 0, events: [] },
  ];
  for (const [index, body] of bodies.entries()) {
    const client = clientFor(body);
    try { await assert.rejects(index === 0 ? client.getSchema('sembom', 1)
      : client.getSummary('sembom', { schemaVersion: 1, from: meta('UTC').from, to: meta('UTC').to }), error => error.kind === 'contract'); }
    finally { client.destroy(); }
  }
});
