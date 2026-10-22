import { ANALYTICS_ROW_LIMITS } from './policy.ts';
import type { AdminPrincipal, AdminQuery, EventSource } from '@tallyfin/core';
import type { SqlDatabase, SqlStatement } from './sql.ts';
import { FUNNEL_DIMENSION_ROW_LIMIT } from './funnel-breakdown.ts';
import { DURATION_SUM_SQL } from './workflow-duration.ts';

const access = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = ? AND g.issuer = ? AND g.subject = ? AND g.role IN ('reader','owner'))";
/** Each query carries the same grant predicate; execute these in one snapshot. */
export function queryStatements(db: SqlDatabase, principal: AdminPrincipal, input: AdminQuery, source: EventSource): SqlStatement[] {
  const grant = [input.projectId, principal.issuer, principal.subject];
  const statements: SqlStatement[] = [
    db.prepare(`SELECT p.* FROM projects p WHERE p.id = ? AND ${access}`).bind(input.projectId, ...grant),
    db.prepare(`SELECT * FROM project_schemas WHERE project_id = ? AND version = ? AND ${access}`).bind(input.projectId, input.version, ...grant),
  ];
  if (input.kind === 'summary') statements.push(db.prepare(`SELECT event_name, SUM(count) AS count FROM event_daily_counts
    WHERE project_id = ? AND schema_version = ? AND source = ? AND event_date BETWEEN ? AND ? AND ${access}
    GROUP BY event_name LIMIT ${ANALYTICS_ROW_LIMITS.summary + 1}`).bind(input.projectId, input.version, source, input.from!, input.to!, ...grant));
  else if (input.kind === 'event') statements.push(db.prepare(`SELECT event_date, dimension_key, count FROM event_daily_counts
    WHERE project_id = ? AND schema_version = ? AND source = ? AND event_name = ? AND event_date BETWEEN ? AND ? AND ${access}
    ORDER BY event_date, dimension_key LIMIT ${ANALYTICS_ROW_LIMITS.dailyDimensions + 1}`).bind(input.projectId, input.version, source, input.name!, input.from!, input.to!, ...grant));
  else if (input.kind === 'workflow-breakdown') statements.push(db.prepare(`SELECT cohort_date, dimension_key, started_count, succeeded_count, failed_count FROM workflow_daily_counts
    WHERE project_id = ? AND schema_version = ? AND source = 'browser' AND workflow_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
    ORDER BY cohort_date, dimension_key LIMIT ${ANALYTICS_ROW_LIMITS.dailyDimensions + 1}`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant));
  else if (input.kind === 'funnel-breakdown') statements.push(db.prepare(`SELECT cohort_date, dimension_key, step_index, reached_count FROM funnel_daily_counts
    WHERE project_id = ? AND schema_version = ? AND funnel_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
    ORDER BY cohort_date, dimension_key, step_index LIMIT ?`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant, FUNNEL_DIMENSION_ROW_LIMIT + 1));
  else if (input.kind === 'funnel') statements.push(db.prepare(`SELECT cohort_date, step_index, SUM(reached_count) AS reached_count FROM funnel_daily_counts
    WHERE project_id = ? AND schema_version = ? AND funnel_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
    GROUP BY cohort_date, step_index ORDER BY cohort_date, step_index LIMIT ${ANALYTICS_ROW_LIMITS.funnelSteps + 1}`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant));
  else if (input.kind === 'workflow') statements.push(db.prepare(`SELECT cohort_date, SUM(started_count) AS started_count,
    SUM(succeeded_count) AS succeeded_count, SUM(failed_count) AS failed_count, ${DURATION_SUM_SQL} FROM workflow_daily_counts
    WHERE project_id = ? AND schema_version = ? AND source = 'browser' AND workflow_id = ? AND cohort_date BETWEEN ? AND ? AND ${access}
    GROUP BY cohort_date LIMIT ${ANALYTICS_ROW_LIMITS.days + 1}`).bind(input.projectId, input.version, input.name!, input.from!, input.to!, ...grant));
  return statements;
}
