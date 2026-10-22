import type { ApiClient } from './client.ts';
import type { EventSource, Project } from './types.ts';
import { validateOverviewIds } from './overview-contract.ts';
import type { OverviewRow } from './overview-contract.ts';
export { OVERVIEW_PAGE_SIZE } from './overview-contract.ts';
export type ServiceRow = Omit<OverviewRow, 'projectId' | 'accessDenied'> & { project: Project };

/** Visible-page read; the server owns project-local windows and authorization. */
export async function projectOverview(client: Pick<ApiClient, 'getProjectOverview'>, projects: readonly Project[], source: EventSource,
  signal: AbortSignal, _now = new Date()): Promise<ServiceRow[]> {
  signal.throwIfAborted();
  if (!projects.length) return [];
  const ids = projects.map(project => project.id); validateOverviewIds(ids);
  const response = await client.getProjectOverview(ids, source, { signal });
  signal.throwIfAborted();
  return response.data.map(({ projectId: _id, accessDenied: _denied, ...row }, i) => ({ ...row, project: projects[i]! }));
}
