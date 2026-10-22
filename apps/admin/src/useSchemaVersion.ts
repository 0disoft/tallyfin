import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from './api/client';
import { latestSchema } from './api/latest-schema';
import { toApiError } from './api/load-state';

/** Selections belong to a connection and project; late defaults never replace typed input. */
export default function useSchemaVersion(client: ApiClient | null, projectId: string | null, refresh: number) {
  const [manual, setManual] = useState<{ client: ApiClient; values: Record<string, string> } | null>(null);
  const [automatic, setAutomatic] = useState<{ client: ApiClient; projectId: string; refresh: number; value: string; error?: ReturnType<typeof toApiError> } | null>(null);
  const chosen = client && projectId && manual?.client === client && Object.hasOwn(manual.values, projectId) ? manual.values[projectId] : undefined;
  const current = automatic?.client === client && automatic.projectId === projectId && automatic.refresh === refresh ? automatic : null;
  const versionInput = chosen ?? current?.value ?? '';
  useEffect(() => {
    if (!client || !projectId || chosen !== undefined) return;
    const controller = new AbortController();
    latestSchema(client, projectId, controller.signal).then(result => {
      if (!controller.signal.aborted) setAutomatic({ client, projectId, refresh, value: String(result.active ?? result.latest ?? '') });
    }).catch(error => {
      if (!controller.signal.aborted) setAutomatic({ client, projectId, refresh, value: '', error: toApiError(error) });
    });
    return () => controller.abort();
  }, [client, projectId, refresh, chosen]);
  const setVersionInput = useCallback((value: string) => {
    if (!client || !projectId) return;
    setManual(previous => ({ client, values: { ...(previous?.client === client ? previous.values : {}), [projectId]: value } }));
  }, [client, projectId]);
  const selectAutomatic = useCallback(() => {
    if (!client || !projectId) return;
    setAutomatic(null);
    setManual(previous => {
      if (previous?.client !== client) return null;
      const values = { ...previous.values }; delete values[projectId];
      return { client, values };
    });
  }, [client, projectId]);
  return { versionInput, setVersionInput, selectAutomatic, automatic: chosen === undefined, loading: !!client && !!projectId && chosen === undefined && !current,
    error: chosen === undefined ? current?.error : undefined };
}
