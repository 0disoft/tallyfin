import type { ExportInput, ExportView } from './csv-export.ts';
import type { Load } from './load-state.ts';
import type { PeriodSnapshot } from './period-comparison.ts';
import type { EventDefinition, EventSeriesResponse, EventSource, Registry } from './types.ts';
import type { WorkflowGroupingState } from './workflow-analysis.ts';

export type DashboardExportState = {
  data: (PeriodSnapshot & { registry: Registry }) | null; validVersion: boolean;
  view: ExportView | 'settings'; source: EventSource; query: string; compare: boolean;
  comparison: Load<PeriodSnapshot> | null; comparisonError: string | null;
  selectedEvent: string | null; analysisEvent: EventDefinition | null; seriesData: EventSeriesResponse | null;
  groupBy: string; propertyComparison: { status: 'loading' | 'ready' | 'error'; series?: EventSeriesResponse } | null;
  workflowDetails: readonly WorkflowGroupingState[];
};

/** Preserve gate priority: current data, comparison, event detail, then workflow dimensions. */
function unavailable(state: DashboardExportState): string | null {
  const { data, validVersion, view, compare, comparison, comparisonError, selectedEvent, analysisEvent,
    seriesData, groupBy, propertyComparison, workflowDetails } = state;
  if (!data || !validVersion) return '현재 기간 조회를 마쳐야 CSV를 내려받을 수 있어요.';
  if (data.workflowErrors?.length) return '실패한 작업 흐름 조회를 복구해야 전체 CSV를 내려받을 수 있어요.';
  if (compare && comparison?.data?.workflowErrors?.length) return '직전 기간의 실패한 작업 흐름을 다시 조회해 주세요.';
  if (compare && comparisonError) return '직전 기간이 보존 범위를 벗어나요. 비교를 끄면 현재 기간 CSV를 내려받을 수 있어요.';
  if (compare && (comparison?.status !== 'ready' || !comparison.data)) return '직전 기간 비교를 마치거나 비교를 꺼 주세요.';
  if (view === 'events' && selectedEvent && (!analysisEvent || !seriesData)) return '선택한 이벤트 상세 조회를 마치거나 상세를 닫아 주세요.';
  if (view === 'events' && compare && groupBy && propertyComparison?.status !== 'ready') return '이벤트 속성별 기간 비교를 마치거나 비교·분류를 해제해 주세요.';
  if (workflowDetails.some(detail => detail.status !== 'ready')) return '속성별 완료율 조회를 마치거나 해당 분류를 해제해 주세요.';
  if (compare && workflowDetails.some(detail => detail.comparisonStatus !== 'ready')) return '속성별 기간 비교를 마치거나 비교를 꺼 주세요.';
  return null;
}

export function dashboardExport(state: DashboardExportState): { input: ExportInput | null; unavailable: string | null } {
  const { data, view, source, query, compare, comparison, selectedEvent, seriesData, groupBy, propertyComparison, workflowDetails } = state;
  const input = data && view !== 'settings' ? { registry: data.registry, current: data, view, source, filter: query,
    workflowSelections: workflowDetails.flatMap(detail => detail.status === 'ready' && detail.data ? [detail.data] : []),
    workflowComparisons: compare ? workflowDetails.flatMap(detail => detail.comparisonStatus === 'ready' && detail.comparisonData ? [detail.comparisonData] : []) : [],
    ...(compare && comparison?.status === 'ready' && comparison.data ? { previous: comparison.data } : {}),
    ...(view === 'events' && selectedEvent && seriesData ? { selection: { eventName: selectedEvent, groupBy: groupBy || null, series: seriesData,
      ...(compare && groupBy && propertyComparison?.status === 'ready' && propertyComparison.series ? { previousSeries: propertyComparison.series } : {}) } } : {}),
  } : null;
  return { input, unavailable: unavailable(state) };
}
