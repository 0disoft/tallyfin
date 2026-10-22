import { addCounts, closed, CollectionError, dateMillis, DAY, emptyOverviewRow, integer, localDate,
  queryDates, SCHEMA_LIMITS, validateOverviewInput, validateRegistry } from '@tallyfin/core';
import type { AdminPrincipal, OverviewResponse, OverviewRow, Registry } from '@tallyfin/core';
import { queryResponse } from './query-response.ts';
import type { EventRow, WorkflowRow } from './query-response.ts';
import { overviewRejections } from './overview-rejections.ts';
import type { ProjectRow, SchemaRow, SqlDatabase, SqlResult, SqlStatement } from './sql.ts';

type State = ProjectRow & { version: number | null; status_schema: SchemaRow['status'] | null;
  definitions_json: string | null; latest_received_at: number | null };
type Plan = { state: State; registry: Registry; from: string; split: string; to: string; offset: number };
const access = "EXISTS (SELECT 1 FROM project_grants g WHERE g.project_id = p.id AND g.issuer = ? AND g.subject = ? AND g.role IN ('reader','owner'))";
const shift = (date: string, days: number) => new Date(dateMillis(date) + days * DAY).toISOString().slice(0, 10);
const invalid = (): never => { throw new CollectionError('storage_unavailable', 503); };
function metadata(db: SqlDatabase, principal: AdminPrincipal, ids: readonly string[]) {
  return db.prepare(`SELECT p.*, s.version, s.status AS status_schema, s.definitions_json FROM projects p
    LEFT JOIN project_schemas s ON s.project_id = p.id AND s.version =
      (SELECT MAX(version) FROM project_schemas WHERE project_id = p.id AND status = 'active')
    WHERE p.id IN (${ids.map(() => '?').join(',')}) AND ${access}`).bind(...ids, principal.issuer, principal.subject);
}
function checked<T>(result: SqlResult<T>[], length: number): SqlResult<T>[] {
  if (result.length !== length || result.some(r => !r.success || !Array.isArray(r.results))) invalid();
  return result;
}
function registryFor(p: State, options: { allowLocalHttp?: boolean }): Registry {
  const definitions: unknown = JSON.parse(p.definitions_json!);
  if (!closed(definitions, ['events', 'workflows'], ['funnels'])) return invalid();
  return validateRegistry({ ...definitions, project: { id: p.id, name: p.name, status: p.status, timeZone: p.time_zone },
    schemaVersion: p.version, schemaStatus: p.status_schema, allowedOrigins: JSON.parse(p.allowed_origins_json),
    limits: { requestsPerMinute: p.requests_per_minute, newReceiptsPerUtcDay: p.new_receipts_per_utc_day } }, options);
}
/** One aggregate snapshot, then sequential bounded rejection pages; at most 42 SQL statements. */
export async function projectOverview(db: SqlDatabase, principal: AdminPrincipal, ids: readonly string[], source: 'browser' | 'server',
  now: number, options: { allowLocalHttp?: boolean; signal?: AbortSignal } = {}): Promise<OverviewResponse> {
  validateOverviewInput(ids, source);
  ids = [...ids];
  if (!integer(now, 0, 8_640_000_000_000_000)) throw new CollectionError('invalid_request', 400);
  const check = () => options.signal?.throwIfAborted(); check();
  const initial = checked(await db.batch<State>([metadata(db, principal, ids)]), 1)[0]!.results; check();
  const states = new Map(initial.map(p => [p.id, p]));
  const rows = ids.map(id => ({ ...emptyOverviewRow(id), error: !states.has(id), accessDenied: !states.has(id) }));
  const statements: SqlStatement[] = [metadata(db, principal, ids)], plans = new Map<string, Plan>();
  const utcTo = new Date(now).toISOString().slice(0, 10), utcFrom = shift(utcTo, -6);
  for (const row of rows) {
    const p = states.get(row.projectId); if (!p || p.version === null) continue;
    try {
      const registry = registryFor(p, options), to = localDate(now, p.time_zone), split = shift(to, -6), from = shift(split, -7);
      const offset = statements.length;
      // Every aggregate repeats authorization; the metadata below shares this batch snapshot.
      const grant = [p.id, principal.issuer, principal.subject];
      statements.push(db.prepare(`SELECT event_name, CASE WHEN event_date >= ? THEN 1 ELSE 0 END AS period, SUM(count) AS count
        FROM event_daily_counts WHERE project_id = ? AND schema_version = ? AND source = ? AND event_date BETWEEN ? AND ?
        AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ? AND ${access}) GROUP BY period, event_name LIMIT ${2 * SCHEMA_LIMITS.events + 1}`)
        .bind(split, p.id, p.version, source, from, to, ...grant));
      const workflow = source === 'browser' ? registry.workflows[0] : undefined;
      statements.push(db.prepare(`SELECT cohort_date, SUM(started_count) AS started_count, SUM(succeeded_count) AS succeeded_count,
        SUM(failed_count) AS failed_count FROM workflow_daily_counts WHERE project_id = ? AND schema_version = ? AND source = 'browser'
        AND workflow_id = ? AND cohort_date BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ? AND ${access})
        GROUP BY cohort_date LIMIT 15`).bind(p.id, p.version, workflow?.id ?? '', from, to, ...grant));
      plans.set(p.id, { state: p, registry, from, split, to, offset });
    } catch { row.error = true; }
  }
  check();
  const results = plans.size ? checked(await db.batch<State | EventRow | WorkflowRow>(statements), statements.length) : []; check();
  const current = new Map(((results[0]?.results ?? []) as State[]).map(p => [p.id, p]));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!, plan = plans.get(row.projectId); if (!plan) continue;
    const p = current.get(row.projectId);
    // Fail closed if access, time zone, schema selection or definitions changed between the two batches.
    if (!p || p.version !== plan.state.version || p.time_zone !== plan.state.time_zone || p.definitions_json !== plan.state.definitions_json) {
      rows[i] = { ...emptyOverviewRow(row.projectId), error: true, accessDenied: !p }; continue;
    }
    try { fillEvents(row, plan, p, results[plan.offset]!.results as (EventRow & { period: number })[], source); }
    catch { rows[i] = { ...emptyOverviewRow(row.projectId), error: true }; continue; }
    fillWorkflow(row, plan, results[plan.offset + 1]!.results as WorkflowRow[], source, now);
  }
  // Receipt and rejection diagnostics belong to the project, independently of any active schema.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!, p = states.get(row.projectId);
    if (!p || row.error) continue;
    try {
      if (row.version === null) row.latestReceivedAt = receivedAt(p.latest_received_at);
      const diagnostics = await overviewRejections(db, principal, p.id, utcFrom, utcTo, now, options.signal);
      row.rejected = diagnostics.rejected; row.latestReceivedAt = receivedAt(diagnostics.latestReceivedAt);
    }
    catch (cause) {
      check();
      if (cause instanceof CollectionError && cause.code === 'forbidden') rows[i] = { ...emptyOverviewRow(row.projectId), error: true, accessDenied: true };
      else row.rejectionUnavailable = true;
    }
  }
  return { source, generatedAt: new Date(now).toISOString(), data: rows };
}
function fillEvents(row: OverviewRow, plan: Plan, state: State, entries: (EventRow & { period: number })[], source: 'browser' | 'server') {
  const names = new Set(plan.registry.events.filter(e => e.source === source).map(e => e.name)), seen = new Set<string>();
  let current = 0, previous = 0;
  if (entries.length > 2 * SCHEMA_LIMITS.events) invalid();
  for (const entry of entries) {
    const key = `${entry.period}:${entry.event_name}`;
    if (![0, 1].includes(entry.period) || !names.has(entry.event_name) || seen.has(key)) invalid();
    seen.add(key);
    if (entry.period === 1) current = addCounts(current, entry.count); else previous = addCounts(previous, entry.count);
  }
  row.version = state.version; row.events = current; row.previousEvents = previous;
  row.latestReceivedAt = receivedAt(state.latest_received_at);
}
function receivedAt(value: number | null): string | null {
  if (value !== null && !integer(value, 0, 8_640_000_000_000_000)) return invalid();
  return value === null ? null : new Date(value).toISOString();
}
function fillWorkflow(row: OverviewRow, plan: Plan, entries: WorkflowRow[], source: 'browser' | 'server', now: number) {
  const definition = source === 'browser' ? plan.registry.workflows[0] : undefined; if (!definition) return;
  row.workflowLabel = definition.label;
  try {
    const dates = new Set(queryDates(plan.from, plan.to, plan.state.time_zone, now));
    if (entries.length > 14 || new Set(entries.map(e => e.cohort_date)).size !== entries.length ||
      entries.some(e => !dates.has(e.cohort_date))) invalid();
    const load = (from: string, to: string) => {
      const meta = { projectId: row.projectId, schemaVersion: plan.registry.schemaVersion, source: 'browser' as const, from, to,
        timeZone: plan.state.time_zone, generatedAt: new Date(now).toISOString(), latestReceivedAt: row.latestReceivedAt, coverage: 'observed-only' as const };
      const response = queryResponse(plan.registry, { projectId: row.projectId, version: plan.registry.schemaVersion, kind: 'workflow', name: definition.id },
        meta, queryDates(from, to, plan.state.time_zone, now), entries.filter(e => e.cohort_date >= from && e.cohort_date <= to), now);
      if (!('summary' in response) || !response.summary || !('completionRate' in response.summary)) return invalid();
      return response.summary.completionRate;
    };
    row.completion = load(plan.split, plan.to); row.previousCompletion = load(plan.from, shift(plan.split, -1));
  } catch { row.workflowUnavailable = true; row.completion = null; row.previousCompletion = null; }
}
