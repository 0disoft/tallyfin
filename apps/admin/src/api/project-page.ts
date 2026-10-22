import { ApiError, DEFAULT_PAGE_LIMIT, type ApiClient } from './client.ts';
import { appendPage } from './pagination.ts';

/** Recheck an off-page selection under current grants; never infer revocation from page one. */
export async function firstProjectPage(client: Pick<ApiClient, 'listProjects' | 'getSettings'>, selectedId: string | null, signal: AbortSignal) {
  const page = await client.listProjects({ limit: DEFAULT_PAGE_LIMIT, signal });
  if (!selectedId || page.data.some(project => project.id === selectedId)) return page;
  try {
    const settings = await client.getSettings(selectedId, { signal });
    return { ...page, data: appendPage(page.data, { data: [settings.project], page: page.page }).items };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ApiError && ['forbidden', 'not_found'].includes(error.kind)) return page;
    throw error;
  }
}
