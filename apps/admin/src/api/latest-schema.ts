import type { ApiClient } from './client.ts';
import { ContractError } from './validate.ts';

/** Scan descending metadata only; an archived newest version is not an SDK default. */
export async function latestSchema(client: Pick<ApiClient, 'listSchemas'>, projectId: string, signal: AbortSignal): Promise<{ active: number | null; latest: number | null }> {
  let beforeVersion: number | null = null, latest: number | null = null;
  while (true) {
    signal.throwIfAborted();
    const page = await client.listSchemas(projectId, { limit: 100, beforeVersion, signal });
    signal.throwIfAborted();
    if (beforeVersion === null) latest = page.latestVersion;
    if (page.projectId !== projectId || page.data.some(row => beforeVersion !== null && row.schemaVersion >= beforeVersion))
      throw new ContractError('스키마 목록의 프로젝트·버전 순서가 맞지 않아요.');
    const active = page.data.find(row => row.schemaStatus === 'active');
    if (active) return { active: active.schemaVersion, latest };
    const next = page.page.beforeVersion;
    if (next === null) return { active: null, latest };
    if (beforeVersion !== null && next >= beforeVersion) throw new ContractError('스키마 목록의 순회 위치가 진행하지 않아요.');
    beforeVersion = next;
  }
}
