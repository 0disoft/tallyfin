import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collectorHarness } from '../collector-harness.ts';
import { seedRetainedFixture } from '../retained-fixture.ts';

test('three isolated collector workers share one fresh D1 and deduplicate a concurrent batch through actual authenticated HTTP', async () => {
  const parent = fileURLToPath(new URL('../../../.tmp/cluster-tests/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'run-')), now = Date.now();
  const { mf, principal, adminToken, collectorNames } = await collectorHarness(directory, now, 3);
  try {
    const db = await mf.getD1Database('DB');
    const fixture = await seedRetainedFixture(db, principal, now, { receipts: 2, attempts: 2, expired: 2, days: 2 });
    const url = await mf.ready;
    const body = JSON.stringify({ schemaVersion: 1, source: 'browser', events: [{ eventId: crypto.randomUUID(), name: 'tool_view',
      occurredAt: new Date(now).toISOString(), properties: { tool: 'loan' } }] });
    const send = async (index: number) => {
      const response = await fetch(new URL(`/worker/${index}/v1/projects/load-00/batches`, url), { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://sembom.example.invalid' }, body, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); assert.equal(response.headers.get('X-Tallyfin-Bench-Worker'), collectorNames[index]);
      return await response.json() as { accepted: number; duplicates: number };
    };
    const receipts = await Promise.all(collectorNames.map((_, index) => send(index)));
    assert.equal(receipts.reduce((sum, row) => sum + row.accepted, 0), 1);
    assert.equal(receipts.reduce((sum, row) => sum + row.duplicates, 0), 2);
    for (const [index, name] of collectorNames.entries()) {
      const shared = await mf.getD1Database('DB', name);
      assert.equal(await shared.prepare('SELECT COUNT(*) AS n FROM event_receipts WHERE project_id=?').bind('load-00').first('n'), 5);
      const response = await fetch(new URL(`/worker/${index}/v1/projects/load-00/summary?schemaVersion=1&from=${fixture.today}&to=${fixture.today}`, url),
        { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); assert.equal(response.headers.get('X-Tallyfin-Bench-Worker'), name);
      assert.equal((await response.json() as { totalEvents: number }).totalEvents, 1801);
    }
    assert.equal((await fetch(new URL('/worker/3/v1/health', url))).status, 404);
    assert.equal((await fetch(new URL('/v1/health', url))).status, 404);
  } finally { await mf.dispose(); }
});

test('cluster harness rejects worker counts outside the bounded local profile before starting a runtime', async () => {
  for (const count of [0, 5, 1.5, NaN]) await assert.rejects(collectorHarness('unused', undefined, count), /invalid-benchmark-worker-count/);
});
