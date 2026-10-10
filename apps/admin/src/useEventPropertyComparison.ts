import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client';
import { loadEventPropertyComparison, type EventPropertyComparison } from './api/event-property-comparison';
import type { EventSeriesResponse, Registry } from './api/types';

type State = { key: string; status: 'loading' | 'ready' | 'error'; series?: EventSeriesResponse; analysis?: EventPropertyComparison };

export default function useEventPropertyComparison(client: ApiClient | null, registry: Registry | null, current: EventSeriesResponse | null, enabled: boolean, context: string | null) {
  const [retry, setRetry] = useState(0), [result, setResult] = useState<State | null>(null);
  const key = JSON.stringify([context, enabled, retry]);
  useEffect(() => {
    if (!enabled || !client || !registry || !current) return;
    const controller = new AbortController();
    setResult({ key, status: 'loading' });
    loadEventPropertyComparison(client, registry, current, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ key, status: 'ready', ...data }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, status: 'error' }); });
    return () => controller.abort();
  }, [client, registry, current, enabled, key]);
  return { state: enabled ? result?.key === key ? result : { key, status: 'loading' as const } : null,
    retry: () => setRetry(value => value + 1) };
}
