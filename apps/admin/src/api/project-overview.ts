import type { ApiClient } from './client.ts';
import { ApiError } from './client.ts';
import type { EventSource, Project } from './types.ts';
import { latestSchema } from './latest-schema.ts';
import { loadPeriod, previousRange, validateWorkflowLoad } from './period-comparison.ts';
import { periodRange, todayInZone } from './dates.ts';
import { rejectionRange } from './rejection-diagnostics.ts';

export const OVERVIEW_PAGE_SIZE = 5;
export type ServiceRow = { project: Project; version: number | null; latestReceivedAt: string | null;
  events: number | null; previousEvents: number | null; workflowLabel: string | null;
  completion: number | null; previousCompletion: number | null; workflowUnavailable: boolean;
  rejected: number | null; rejectionUnavailable: boolean; error?: boolean };
const empty = (project: Project): ServiceRow => ({ project, version: null, latestReceivedAt: null, events: null,
  previousEvents: null, workflowLabel: null, completion: null, previousCompletion: null,
  workflowUnavailable: false, rejected: null, rejectionUnavailable: false });

/** Opt-in visible-page reads only: two projects at a time; ApiClient also bounds HTTP concurrency. */
export async function projectOverview(client: ApiClient, projects: readonly Project[], source: EventSource, signal: AbortSignal, now = new Date()): Promise<ServiceRow[]> {
  if (projects.length > OVERVIEW_PAGE_SIZE || new Set(projects.map(project => project.id)).size !== projects.length)
    throw new RangeError('Invalid service overview page');
  const rows: ServiceRow[] = new Array(projects.length); let next = 0;
  const rethrowAccess = (error: unknown) => {
    signal.throwIfAborted();
    if (error instanceof ApiError && ['unauthorized', 'forbidden'].includes(error.kind)) throw error;
  };
  async function read(project: Project): Promise<ServiceRow> {
    const row = empty(project);
    const selected = await latestSchema(client, project.id, signal);
    if (selected.active === null) return row;
    const registry = await client.getSchema(project.id, selected.active, { signal });
    const range = periodRange(todayInZone(project.timeZone, now), 7), prior = previousRange(range);
    const current = await loadPeriod(client, registry, range, signal, source, 'events');
    const previous = await loadPeriod(client, registry, prior, signal, source, 'events');
    row.version = registry.schemaVersion; row.events = current.summary.totalEvents; row.previousEvents = previous.summary.totalEvents;
    row.latestReceivedAt = current.summary.meta.latestReceivedAt;
    const definition = source === 'browser' ? registry.workflows[0] : undefined;
    if (definition) {
      row.workflowLabel = definition.label;
      try {
        const load = async (window: typeof range) => {
          const value = { definition, response: await client.getWorkflowDaily(project.id, definition.id,
            { schemaVersion: registry.schemaVersion, ...window, signal }) };
          validateWorkflowLoad(value, registry, window); return value.response.summary.completionRate;
        };
        row.completion = await load(range); row.previousCompletion = await load(prior);
      } catch (error) { rethrowAccess(error); row.workflowUnavailable = true; row.completion = null; row.previousCompletion = null; }
    }
    try { row.rejected = (await client.getCollectionRejections(project.id, { ...rejectionRange(now), signal })).summary.rejectedRequests; }
    catch (error) { rethrowAccess(error); row.rejectionUnavailable = true; }
    return row;
  }
  async function worker() {
    while (next < projects.length) {
      signal.throwIfAborted(); const index = next++, project = projects[index]!;
      try { rows[index] = await read(project); }
      catch { signal.throwIfAborted(); rows[index] = { ...empty(project), error: true }; }
    }
  }
  await Promise.all([worker(), worker()]); return rows;
}
