import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SqlDatabase, SqlStatement } from '@tallyfin/storage-d1';
import { createWorker } from '../src/index.ts';

test('scheduled reports include clamped wall-clock lag without changing the cleanup timestamp', async t => {
  const records: any[] = [];
  t.mock.method(console, 'log', (line: string) => records.push(JSON.parse(line)));
  t.mock.method(console, 'warn', (line: string) => records.push(JSON.parse(line)));
  const now = Date.parse('2026-10-23T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const statement: SqlStatement = { bind() { return this; } };
  for (const offset of [-123, 0, 1]) {
    let batches = 0;
    const db: SqlDatabase = { prepare: () => statement, async batch<T>() {
      const rows = ++batches === 1 ? [[], [{ last_project_id: '', revision: 0 }]] : [[]];
      return rows.map(results => ({ success: true, results: results as T[], meta: { changes: 1 } }));
    } };
    await createWorker().scheduled({ scheduledTime: now + offset }, { DB: db });
    assert.equal(batches, 3);
    const report = records.at(-1);
    assert.equal(report.code, 'retention_cleanup'); assert.equal(report.execution.scheduleLagMs, Math.max(0, -offset));
    assert.equal(report.execution.stopReason, 'empty_page'); assert.ok(report.execution.elapsedMs >= 0);
  }
  assert.equal(records.length, 3);
  const cause = { privateDetail: 'must-not-be-logged' };
  const unavailable: SqlDatabase = { prepare: () => statement, batch: async () => { throw cause; } };
  await assert.rejects(createWorker().scheduled({ scheduledTime: now }, { DB: unavailable }),
    error => error instanceof Error && error.cause === cause);
  assert.equal(records.length, 5);
  const partial = records[3], marker = records[4];
  assert.equal(partial.execution.stopReason, 'storage_error'); assert.equal(partial.attempted, 0);
  assert.equal(partial.execution.scheduleLagMs, 0); assert.equal(marker.code, 'retention_cleanup_failed');
  assert.equal(partial.runId, marker.runId); assert.ok(!JSON.stringify(records).includes('must-not-be-logged'));
});
