import { readFile } from 'node:fs/promises';
import { DAY, dimensionKey, localDate, validateRegistry } from '@tallyfin/core';
import type { AdminPrincipal } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { initialize } from '../provision/local.ts';
import { Provisioner } from '../provision/store.ts';

export const RETAINED_PROJECTS = ['load-00', 'load-01', 'load-02', 'load-03', 'load-04', 'load-05'];
export const TOOLS = ['grade', 'loan', 'timer'] as const;
const range = 'WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < ?)';
export const DEFAULT_RETAINED_SIZE = { receipts: 6000, attempts: 600, expired: 1200, days: 90 };

/** Direct SQL synthetic history, excluded from HTTP timings; not evidence of past ingestion throughput. */
export async function seedRetainedFixture(db: SqlDatabase, principal: AdminPrincipal, now: number,
  size = DEFAULT_RETAINED_SIZE) {
  for (const count of Object.values(size)) if (!Number.isInteger(count) || count < 1 || count > 10000) throw Error('invalid-fixture-size');
  if (size.days > 90) throw Error('invalid-fixture-days');
  await initialize(db, true);
  const example = JSON.parse(await readFile(new URL('../../api/examples/registry.json', import.meta.url), 'utf8'));
  const provision = new Provisioner(db), today = localDate(now, 'Asia/Seoul');
  const atDay = (offset: number) => new Date(Date.parse(today + 'T00:00:00Z') - offset * DAY).toISOString().slice(0, 10);
  for (const id of RETAINED_PROJECTS) {
    const registry = validateRegistry({ ...example, project: { ...example.project, id, name: id } });
    await provision.apply(await provision.plan('register', registry), now);
    await provision.apply(await provision.plan('grant', { projectId: id, ...principal, role: 'owner' }), now);
    const statements = [];
    for (const [prefix, count, receivedAt] of [['10000000', size.receipts, now - DAY], ['20000000', size.expired, now - 3 * DAY]] as const)
      statements.push(db.prepare(`${range} INSERT INTO event_receipts(project_id,source,event_id,schema_version,payload_hash,received_at,expires_at)
        SELECT ?, 'browser', printf(? || '-0000-4000-8000-%012d',n), 1, ?, ?, ? FROM numbers`)
        .bind(count, id, prefix, 'a'.repeat(64), receivedAt, receivedAt + 2 * DAY));
    for (const [prefix, count, startedAt] of [['30000000', size.attempts, now - DAY], ['40000000', size.expired, now - 4 * DAY]] as const)
      statements.push(db.prepare(`${range} INSERT INTO workflow_attempts(project_id,source,attempt_id,schema_version,workflow_id,started_at,cohort_date,
        dimension_key,start_seen,terminal_kind,terminal_at,expires_at)
        SELECT ?, 'browser', printf(? || '-0000-4000-8000-%012d',n), 1, 'calculation', ?, ?, ?, 1, 'success', ?, ? FROM numbers`)
        .bind(count, id, prefix, startedAt, localDate(startedAt, 'Asia/Seoul'), dimensionKey({ tool: 'loan' }), startedAt, startedAt + 3 * DAY));
    for (const tool of TOOLS) {
      for (const definition of registry.events) for (const [days, offset] of [[size.days, 0], [20, 90]] as const)
        statements.push(db.prepare(`${range} INSERT INTO event_daily_counts(project_id,schema_version,source,event_date,event_name,dimension_key,count,updated_at)
          SELECT ?,1,'browser',date(?,'-' || (n-1+?) || ' days'),?,?,100,? FROM numbers`)
          .bind(days, id, today, offset, definition.name, dimensionKey({ tool }, Object.keys(definition.properties)), now));
      for (const [days, offset] of [[size.days, 0], [20, 90]] as const)
        statements.push(db.prepare(`${range} INSERT INTO workflow_daily_counts(project_id,schema_version,source,cohort_date,workflow_id,dimension_key,
          started_count,succeeded_count,failed_count,updated_at)
          SELECT ?,1,'browser',date(?,'-' || (n-1+?) || ' days'),'calculation',?,100,80,0,? FROM numbers`)
          .bind(days, id, today, offset, dimensionKey({ tool }), now));
    }
    const result = await db.batch(statements); if (result.some(row => !row.success)) throw Error('seed-failed');
  }
  return { today, oldest: atDay(89), projects: RETAINED_PROJECTS, size };
}
