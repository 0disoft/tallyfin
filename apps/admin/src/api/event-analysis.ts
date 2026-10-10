import { ContractError } from './validate.ts';
import type { EventDefinition, EventSeriesResponse, PropertyBucket, Registry } from './types.ts';

export type PropertyAnalysis = { total: number; rows: { key: string; value: PropertyBucket['value']; count: number;
  share: number | null; daily: { date: string; count: number }[] }[] };
export type EventGrouping = { context: string; property: string } | null;
export function eventContext(registry: Registry, event: EventDefinition): string {
  return JSON.stringify([registry.project.id, registry.schemaVersion, event.source, event.name]);
}
export function eventPropertyNames(event: EventDefinition | null): string[] {
  return event ? Object.keys(event.properties) : [];
}
export function selectedGrouping(registry: Registry, event: EventDefinition, selection: EventGrouping): string {
  return selection?.context === eventContext(registry, event) && eventPropertyNames(event).includes(selection.property) ? selection.property : '';
}
function invalid(): never { throw new ContractError('속성별 응답의 값·날짜·합계가 등록 정의와 맞지 않아요.'); }
function count(value: number): number { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; }
function add(a: number, b: number): number { return count(a + b); }
function allowed(event: EventDefinition, name: string, value: PropertyBucket['value']): boolean {
  const property = event.properties[name]; if (!property) return false;
  if (value === null) return !property.required;
  if (property.type === 'boolean') return typeof value === 'boolean';
  if (property.type === 'enum') return typeof value === 'string' && property.values.includes(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= property.minimum && value <= property.maximum;
}
/** Validate the complete daily response before producing any chart or percentage. */
export function analyzeEventSeries(series: EventSeriesResponse, event: EventDefinition): PropertyAnalysis | null {
  if (series.eventName !== event.name || series.meta.source !== event.source) invalid();
  if (series.groupBy !== null && !eventPropertyNames(event).includes(series.groupBy)) invalid();
  const from = Date.parse(`${series.meta.from}T00:00:00Z`), to = Date.parse(`${series.meta.to}T00:00:00Z`);
  const length = (to - from) / 86400000 + 1;
  if (!Number.isInteger(length) || length < 1 || length > 31 || series.days.length !== length) invalid();
  const grouped = series.groupBy !== null, rows = new Map<string, { value: PropertyBucket['value']; count: number; daily: Map<string, number> }>();
  let total = 0;
  series.days.forEach((day, index) => {
    if (day.date !== new Date(from + index * 86400000).toISOString().slice(0, 10)) invalid();
    total = add(total, count(day.count));
    let subtotal = 0; const seen = new Set<string>();
    if (!grouped && day.breakdown.length) invalid();
    for (const bucket of day.breakdown) {
      if (!allowed(event, series.groupBy!, bucket.value)) invalid();
      const key = JSON.stringify(bucket.value);
      if (seen.has(key)) invalid(); seen.add(key);
      subtotal = add(subtotal, count(bucket.count));
      const row = rows.get(key) ?? { value: bucket.value, count: 0, daily: new Map() };
      row.count = add(row.count, bucket.count); row.daily.set(day.date, bucket.count); rows.set(key, row);
    }
    if (grouped && subtotal !== day.count) invalid();
  });
  if (total !== count(series.totalEvents)) invalid();
  if (!grouped) return null;
  return { total, rows: [...rows.entries()].map(([key, row]) => ({ key, value: row.value, count: row.count,
    share: total === 0 ? null : row.count / total * 100,
    daily: series.days.map(day => ({ date: day.date, count: row.daily.get(day.date) ?? 0 })) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)) };
}
