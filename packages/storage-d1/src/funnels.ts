import { CollectionError, DAY, integer, matches, NAME, PROJECT_ID, UUID } from '@tallyfin/core';
import type { FunnelRunState, IngestPlan } from '@tallyfin/core';
import { bulk } from './sql.ts';
import type { SqlDatabase, SqlStatement } from './sql.ts';

export interface FunnelRunRow {
  project_id: string; run_id: string; schema_version: number; funnel_id: string; started_at: number;
  cohort_date: string; dimension_key: string; step_times_json: string; expires_at: number;
}
export function readFunnelRun(row: FunnelRunRow): FunnelRunState {
  try {
    if (!matches(row.project_id, PROJECT_ID) || !matches(row.run_id, UUID) || !matches(row.funnel_id, NAME) ||
      !integer(row.schema_version, 1, 2147483647) || !integer(row.started_at, 0, 8_640_000_000_000_000 - 3 * DAY) ||
      row.expires_at !== row.started_at + 3 * DAY || typeof row.cohort_date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.cohort_date) || new Date(`${row.cohort_date}T00:00:00Z`).toISOString().slice(0, 10) !== row.cohort_date ||
      typeof row.dimension_key !== 'string' || new TextEncoder().encode(row.dimension_key).byteLength > 512 ||
      !Array.isArray(JSON.parse(row.dimension_key)) || typeof row.step_times_json !== 'string' || row.step_times_json.length > 256) throw Error();
    const times: unknown = JSON.parse(row.step_times_json);
    if (!Array.isArray(times) || times.length < 2 || times.length > 10) throw Error();
    let previous = row.started_at;
    for (const [index, time] of times.entries()) {
      if (time === null) continue;
      if (!integer(time, previous, row.started_at + DAY) || (index === 0 && time !== row.started_at)) throw Error();
      previous = time;
    }
    return { projectId: row.project_id, schemaVersion: row.schema_version, funnelId: row.funnel_id, runId: row.run_id,
      startedAt: row.started_at, cohortDate: row.cohort_date, dimensionKey: row.dimension_key,
      stepTimes: times as (number | null)[], expiresAt: row.expires_at };
  } catch { throw new CollectionError('storage_unavailable', 503); }
}

/** Join browser/server runs in the same project revision guard; never write raw observations. */
export function funnelStatements(db: SqlDatabase, projectId: string, version: number, now: number, plan: IngestPlan): SqlStatement[] {
  const statements = bulk(db, 'funnel_runs', ['project_id', 'run_id', 'schema_version', 'funnel_id', 'started_at',
    'cohort_date', 'dimension_key', 'step_times_json', 'expires_at'], plan.funnelRuns.map(run => [projectId, run.runId,
      version, run.funnelId, run.startedAt, run.cohortDate, run.dimensionKey, JSON.stringify(run.stepTimes), run.expiresAt]),
    `ON CONFLICT(project_id,run_id) DO UPDATE SET schema_version=excluded.schema_version, funnel_id=excluded.funnel_id,
      started_at=excluded.started_at, cohort_date=excluded.cohort_date, dimension_key=excluded.dimension_key,
      step_times_json=excluded.step_times_json, expires_at=excluded.expires_at`);
  // Advance earlier steps before later ones, including across different runs in one batch.
  // Batch only one step index per statement so row visitation order cannot break the invariant.
  const byStep = new Map<number, typeof plan.funnels>();
  for (const delta of plan.funnels) {
    const group = byStep.get(delta.stepIndex);
    if (group) group.push(delta); else byStep.set(delta.stepIndex, [delta]);
  }
  for (let index = 0; index < 10; index++) {
    const deltas = byStep.get(index) ?? [];
    statements.push(...bulk(db, 'funnel_daily_counts', ['project_id', 'schema_version', 'cohort_date', 'funnel_id',
      'dimension_key', 'step_index', 'reached_count', 'updated_at'], deltas.map(delta => [projectId, version,
        delta.cohortDate, delta.funnelId, delta.dimensionKey, delta.stepIndex, delta.reachedCount, now]),
      'ON CONFLICT(project_id,schema_version,cohort_date,funnel_id,dimension_key,step_index) DO UPDATE SET reached_count=reached_count+excluded.reached_count, updated_at=max(updated_at,excluded.updated_at)'));
  }
  return statements;
}
