import type { EventDefinition, EventSource, Registry, SummaryResponse } from './types.ts';
import type { WorkflowLoad } from './period-comparison.ts';
import type { DailyRecord } from '../data.ts';

export type EventRow = { definition: EventDefinition; source: EventSource | null; count: number | null };

/** Keep definition order, then unknown response order. Missing/unselected counts stay unknown. */
export function dashboardEvents(registry: Registry | null, summary: SummaryResponse | null, source: EventSource, query: string) {
  const definitions = registry?.events ?? [], events = summary?.events ?? [];
  const counts = new Map(events.map(event => [event.name, event.count]));
  const names = new Set(definitions.map(event => event.name));
  const registered: EventRow[] = definitions.map(definition => ({ definition, source: definition.source,
    count: definition.source === source ? counts.get(definition.name) ?? null : null }));
  const unknown: EventRow[] = registry ? events.filter(event => !names.has(event.name)).map(event => ({
    definition: { name: event.name, label: '등록에 없음', source: 'browser', properties: {} }, source: null, count: event.count,
  })) : [];
  const rows = [...registered, ...unknown], search = query.trim().toLowerCase();
  return { rows, filtered: rows.filter(row => `${row.definition.name} ${row.definition.label}`.toLowerCase().includes(search)),
    browserCount: registered.filter(row => row.source === 'browser').length,
    serverCount: registered.filter(row => row.source === 'server').length };
}

export function workflowRecords({ definition, response }: WorkflowLoad): DailyRecord[] {
  return response.days.map(day => ({ date: day.date, events: {
    [definition.startEvent]: day.startedAttempts, [definition.successEvent]: day.succeededAttempts,
  } }));
}
