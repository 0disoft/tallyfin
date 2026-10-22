import { useEffect, useState } from 'react';
import { toApiError, type Load } from './api/load-state';
import type { ApiClient, ApiError } from './api/client';
import { assertMeta, loadPeriod, previousRange, type PeriodSnapshot } from './api/period-comparison';
import { analyzeEventSeries, type PropertyAnalysis } from './api/event-analysis';
import type { DateRange } from './api/dates';
import type { EventDefinition, EventSeriesResponse, EventSource, Registry } from './api/types';
import type { Period, View } from './data';

export type MainData = PeriodSnapshot & { registry: Registry };

export function useMainAnalysis({ client, activeProjectId, activeTimeZone, version, validVersion, currentRange, dateError, deniedRead, period, refreshTick, view, mainKey, source }: { client: ApiClient | null; activeProjectId: string | null; activeTimeZone: string | null; version: number;
  validVersion: boolean; currentRange: DateRange | null; dateError: string | null; deniedRead: ApiError | null;
  period: Period; refreshTick: number; view: View; mainKey: string; source: EventSource }) {
  const [main, setMain] = useState<Load<MainData> & { key?: string }>({ status: 'idle' });
  useEffect(() => {
    if (deniedRead || view === 'settings' || !client || !activeProjectId || !activeTimeZone || !validVersion || !currentRange || dateError) { setMain({ status: 'idle' }); return; }
    const controller = new AbortController();
    setMain({ status: 'loading', key: mainKey });
    const range = currentRange;
    (async () => {
      try {
        const registry = await client.getSchema(activeProjectId, version, { signal: controller.signal });
        const snapshot = await loadPeriod(client, registry, range, controller.signal, source);
        if (controller.signal.aborted) return;
        setMain({ status: 'ready', key: mainKey, data: { registry, ...snapshot } });
      } catch (error) {
        if (controller.signal.aborted) return;
        setMain({ status: 'error', key: mainKey, error: toApiError(error) });
      }
    })();
    return () => controller.abort();
  }, [client, activeProjectId, activeTimeZone, version, validVersion, period, refreshTick, view, mainKey, dateError, deniedRead]);
  return [main, setMain] as const;
}

export function usePeriodComparison({ client, compare, aggregateComparisonAvailable, view, mainData, comparisonError, comparisonKey, source }: { client: ApiClient | null; compare: boolean; aggregateComparisonAvailable: boolean; view: View;
  mainData: MainData | undefined; comparisonError: string | null; comparisonKey: string; source: EventSource }) {
  const [comparison, setComparison] = useState<Load<PeriodSnapshot> & { key?: string }>({ status: 'idle' });
  useEffect(() => {
    if (!compare || !aggregateComparisonAvailable || view === 'settings' || !client || !mainData || comparisonError) { setComparison({ status: 'idle' }); return; }
    const controller = new AbortController();
    setComparison({ status: 'loading', key: comparisonKey });
    loadPeriod(client, mainData.registry, previousRange(mainData.range), controller.signal, source)
      .then(data => { if (!controller.signal.aborted) setComparison({ status: 'ready', key: comparisonKey, data }); })
      .catch(error => { if (!controller.signal.aborted) setComparison({ status: 'error', key: comparisonKey, error: toApiError(error) }); });
    return () => controller.abort();
  }, [client, compare, mainData, comparisonKey, view, comparisonError, aggregateComparisonAvailable]);
  return [comparison, setComparison] as const;
}

export function useEventSeries({ client, view, analysisEvent, analysisRegistry, currentRange, seriesKey, version, source, groupBy }: { client: ApiClient | null; view: View; analysisEvent: EventDefinition | null; analysisRegistry: Registry | null;
  currentRange: DateRange | null; seriesKey: string | null; version: number; source: EventSource; groupBy: string }) {
  const [series, setSeries] = useState<Load<EventSeriesResponse> & { key?: string; analysis?: PropertyAnalysis | null }>({ status: 'idle' });
  useEffect(() => {
    if (view !== 'events' || !client || !analysisEvent || !analysisRegistry || !currentRange || !seriesKey) { setSeries({ status: 'idle' }); return; }
    const controller = new AbortController();
    setSeries({ status: 'loading', key: seriesKey });
    client.getEventDaily(analysisRegistry.project.id, analysisEvent.name, { schemaVersion: version, from: currentRange.from, to: currentRange.to, source, groupBy: groupBy || undefined, signal: controller.signal })
      .then(next => {
        if (controller.signal.aborted) return;
        assertMeta(next.meta, analysisRegistry, currentRange, source);
        const analysis = analyzeEventSeries(next, analysisEvent);
        setSeries({ status: 'ready', key: seriesKey, data: next, analysis });
      })
      .catch(error => { if (!controller.signal.aborted) setSeries({ status: 'error', key: seriesKey, error: toApiError(error) }); });
    return () => controller.abort();
  }, [client, analysisRegistry, analysisEvent, currentRange?.from, currentRange?.to, seriesKey, groupBy, version, view]);
  return [series, setSeries] as const;
}

