import { CollectionError } from './types.ts';
import type { EventSource, PreparedEvent, Registry } from './types.ts';
import type { FunnelEvent, PreparedFunnelObservation } from './funnel.ts';
import { closed, DAY, dimensionKey, localDate, matches, NAME, utcMillis, UUID } from './value.ts';

/** Properties and event time were validated by the shared batch preparation path. */
export function prepareFunnelStage(prepared: PreparedEvent, registry: Registry, source: EventSource,
  receivedAt: number): PreparedFunnelObservation {
  const link = prepared.event.funnel;
  if (!closed(link, ['funnelId', 'runId', 'startedAt']) || !matches(link.funnelId, NAME) || !matches(link.runId, UUID))
    throw new CollectionError('invalid_event', 422);
  const definition = registry.funnels?.find(funnel => funnel.id === link?.funnelId);
  if (!link || !definition) throw new CollectionError('invalid_event', 422);
  const stepIndex = definition.steps.findIndex(step => step.eventName === prepared.event.name && step.source === source);
  const startedAt = utcMillis(link.startedAt);
  if (stepIndex < 0 || startedAt > prepared.occurredAt || prepared.occurredAt - startedAt > DAY ||
    (stepIndex === 0 && startedAt !== prepared.occurredAt)) throw new CollectionError('invalid_event', 422);
  const event: FunnelEvent = { eventId: prepared.event.eventId, name: prepared.event.name,
    properties: prepared.event.properties, occurredAt: prepared.event.occurredAt,
    funnel: { funnelId: definition.id, runId: link.runId, startedAt: new Date(startedAt).toISOString() } };
  return { projectId: registry.project.id, schemaVersion: registry.schemaVersion, source, receivedAt, event,
    eventDate: prepared.eventDate, eventDimensionKey: prepared.dimensionKey, payloadHash: '', stepIndex,
    stepCount: definition.steps.length, startedAt, occurredAt: prepared.occurredAt,
    cohortDate: localDate(startedAt, registry.project.timeZone), dimensionKey: dimensionKey(event.properties, definition.dimensions) };
}
