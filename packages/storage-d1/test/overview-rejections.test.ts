import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY } from '@tallyfin/core';
import { overviewRejections, OVERVIEW_REJECTION_PAGE_SIZE } from '../src/overview-rejections.ts';
import type { SqlDatabase } from '../src/sql.ts';

const principal = { issuer: 'https://identity.example.invalid', subject: 'reader' };
const from = '2026-10-17', to = '2026-10-23', start = Date.parse(from), now = Date.parse(to) + DAY - 1;
function fixture(size: number, alter?: (page: number, result: any[]) => void) {
  let pages = 0, maxRows = 0, statements = 0, active = 0, maxActive = 0;
  class Statement {
    values: any[] = [];
    readonly sql: string;
    constructor(sql: string) { this.sql = sql; }
    bind(...values: any[]) { this.values = values; return this; }
  }
  const db: SqlDatabase = { prepare: sql => new Statement(sql), batch: async <T>(input: any[]) => {
    statements += input.length; active++; maxActive = Math.max(active, maxActive);
    try {
      const page = ++pages, query = input[1] as Statement;
      assert.ok(query.sql.includes(`LIMIT ${OVERVIEW_REJECTION_PAGE_SIZE}`));
      assert.ok(query.sql.includes('project_grants'));
      const offset = Math.floor((query.values[3] - start) / 60000) + 1;
      const rows = Array.from({ length: Math.max(0, Math.min(OVERVIEW_REJECTION_PAGE_SIZE, size - offset)) }, (_, i) => {
        const minute = start + (offset + i) * 60000;
        return { minute_start: minute, rejections_json: JSON.stringify({ invalid_event: { count: 1, lastRejectedAt: minute } }).padEnd(2048, ' ') };
      });
      maxRows = Math.max(maxRows, rows.length);
      const result: any[] = [{ success: true, results: [{ latest_received_at: null }], meta: { changes: 0 } },
        { success: true, results: rows, meta: { changes: 0 } }];
      alter?.(page, result); return result;
    } finally { active--; }
  } };
  return { db, totals: () => ({ pages, statements, maxRows, maxActive }) };
}
test('bounded pages cover empty, exact page, two pages and all 10080 minutes without accumulating rows', async () => {
  for (const size of [0, 4095, 4096, 8192, 10080]) {
    const f = fixture(size), result = await overviewRejections(f.db, principal, 'sample', from, to, now);
    assert.equal(result.rejected, size);
    assert.deepEqual(f.totals(), { pages: Math.min(3, Math.floor(size / 4096) + 1), statements: Math.min(3, Math.floor(size / 4096) + 1) * 2,
      maxRows: Math.min(size, 4096), maxActive: 1 });
  }
});
test('later corrupt pages, overflow, repeated cursor and denial never return partial sums', async () => {
  for (const alter of [
    (p: number, r: any[]) => { if (p === 2) r[1].results[0].rejections_json = '{'; },
    (p: number, r: any[]) => { if (p === 2) r[1].results[0].minute_start -= 60000; },
    (p: number, r: any[]) => { if (p === 2) r[0].results = []; },
    (p: number, r: any[]) => { if (p === 2) r[1].results[0].rejections_json = JSON.stringify({ minute_limit: { count: Number.MAX_SAFE_INTEGER, lastRejectedAt: r[1].results[0].minute_start } }); },
  ]) {
    const f = fixture(4097, alter);
    await assert.rejects(overviewRejections(f.db, principal, 'sample', from, to, now));
    assert.equal(f.totals().pages, 2);
  }
});
test('cancellation between pages keeps its exact reason and starts no later page', async () => {
  const controller = new AbortController(), reason = { cancelled: true };
  const f = fixture(4097, () => controller.abort(reason));
  await assert.rejects(overviewRejections(f.db, principal, 'sample', from, to, now, controller.signal), e => e === reason);
  assert.equal(f.totals().pages, 1);
});
