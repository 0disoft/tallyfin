import type { ApiClient } from './client.ts';
import type { EventSource, Project } from './types.ts';
import { validateOverviewIds } from './overview-contract.ts';
import type { OverviewRow } from './overview-contract.ts';
import { ContractError } from './validate.ts';
export { OVERVIEW_PAGE_SIZE } from './overview-contract.ts';
export type ServiceRow = Omit<OverviewRow, 'projectId' | 'accessDenied'> & { project: Project; generatedAt: string };

/** Visible-page read; the server owns project-local windows and authorization. */
export async function projectOverview(client: Pick<ApiClient, 'getProjectOverview'>, projects: readonly Project[], source: EventSource,
  signal: AbortSignal, _now = new Date()): Promise<ServiceRow[]> {
  signal.throwIfAborted();
  if (!projects.length) return [];
  const selected = projects.slice(), ids = selected.map(project => project.id); validateOverviewIds(ids);
  const response = await client.getProjectOverview(ids, source, { signal });
  signal.throwIfAborted();
  return response.data.map(({ projectId: _id, accessDenied: _denied, ...row }, i) => {
    const project = selected[i]!;
    if (row.period && row.period.timeZone !== project.timeZone) throw new ContractError('통합 현황의 시간대가 프로젝트와 달라요.');
    return { ...row, project, generatedAt: response.generatedAt };
  });
}
