import type { ApiClient } from './client.ts';
import { analyzeEventSeries } from './event-analysis.ts';
import { assertMeta, countChange, previousRange, rateChange } from './period-comparison.ts';
import type { EventSeriesResponse, PropertyBucket, Registry } from './types.ts';
import { ContractError } from './validate.ts';

export type EventPropertyComparison = { rows: { key: string; value: PropertyBucket['value'];
  currentCount: number; previousCount: number; currentShare: number | null; previousShare: number | null;
  countChange: number | null; shareChange: number | null }[] };

function currentAnalysis(current: EventSeriesResponse, registry: Registry) {
  assertMeta(current.meta, registry, { from: current.meta.from, to: current.meta.to }, current.meta.source);
  const event = registry.events.find(event => event.name === current.eventName && event.source === current.meta.source);
  if (!event || !current.groupBy) throw new ContractError('등록된 이벤트 속성을 선택해야 기간을 비교할 수 있어요.');
  return { event, analysis: analyzeEventSeries(current, event)! };
}

export function compareEventProperties(current: EventSeriesResponse, previous: EventSeriesResponse, registry: Registry): EventPropertyComparison {
  const { event, analysis: now } = currentAnalysis(current, registry);
  assertMeta(previous.meta, registry, previousRange(current.meta), current.meta.source);
  if (previous.eventName !== current.eventName || previous.groupBy !== current.groupBy)
    throw new ContractError('이벤트 속성 비교 응답이 현재 분류와 맞지 않아요.');
  const before = analyzeEventSeries(previous, event)!;
  const currentRows = new Map(now.rows.map(row => [row.key, row])), previousRows = new Map(before.rows.map(row => [row.key, row]));
  return { rows: [...new Set([...currentRows.keys(), ...previousRows.keys()])].map(key => {
    const a = currentRows.get(key), b = previousRows.get(key);
    const currentCount = a?.count ?? 0, previousCount = b?.count ?? 0;
    const currentShare = now.total === 0 ? null : currentCount / now.total * 100;
    const previousShare = before.total === 0 ? null : previousCount / before.total * 100;
    return { key, value: (a ?? b)!.value, currentCount, previousCount, currentShare, previousShare,
      countChange: countChange(currentCount, previousCount), shareChange: rateChange(currentShare, previousShare) };
  }).sort((a, b) => b.currentCount - a.currentCount || b.previousCount - a.previousCount || a.key.localeCompare(b.key)) };
}

export async function loadEventPropertyComparison(client: ApiClient, registry: Registry, current: EventSeriesResponse, signal: AbortSignal) {
  currentAnalysis(current, registry);
  signal.throwIfAborted();
  const series = await client.getEventDaily(registry.project.id, current.eventName, { schemaVersion: registry.schemaVersion,
    ...previousRange(current.meta), source: current.meta.source, groupBy: current.groupBy!, signal });
  signal.throwIfAborted();
  return { series, analysis: compareEventProperties(current, series, registry) };
}
