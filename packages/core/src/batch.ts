import { CollectionError } from './types.ts';
import type { BrowserBatch, BrowserEvent, EventSource, PreparedBatch, PreparedEvent, PreparedServerBatch, Properties, PropertyDefinition, Registry, ServerBatch } from './types.ts';
import { canonicalEvent, closed, DAY, dimensionKey, has, integer, localDate, matches, MAX_BODY_BYTES, NAME, record, sha256, utcMillis, UUID } from './value.ts';

export function parseBatch(body: string): BrowserBatch {
  return parseForSource(body, 'browser') as BrowserBatch;
}
/** Contract validation only; the collector must authenticate and authorize the publisher separately. */
export function parseServerBatch(body: string): ServerBatch {
  return parseForSource(body, 'server') as ServerBatch;
}
function parseForSource(body: string, source: EventSource): BrowserBatch | ServerBatch {
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new CollectionError('invalid_request', 413);
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
  if (!closed(value, ['schemaVersion', 'source', 'events']) || !integer(value.schemaVersion, 1, 2_147_483_647) || value.source !== source ||
    !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 20) throw new CollectionError('invalid_request', 400);
  const ids = new Set<string>();
  for (const event of value.events) {
    if (!closed(event, ['eventId', 'name', 'occurredAt', 'properties'], source === 'browser' ? ['attempt'] : []) || !matches(event.eventId, UUID) || !matches(event.name, NAME) ||
      !record(event.properties) || Object.keys(event.properties).length > 4) throw new CollectionError('invalid_event', 422);
    utcMillis(event.occurredAt);
    if (ids.has(event.eventId)) throw new CollectionError('invalid_event', 422);
    ids.add(event.eventId);
    if (has(event, 'attempt')) {
      if (!closed(event.attempt, ['workflowId', 'attemptId', 'startedAt']) || !matches(event.attempt.workflowId, NAME) || !matches(event.attempt.attemptId, UUID))
        throw new CollectionError('invalid_event', 422);
      utcMillis(event.attempt.startedAt);
    }
  }
  // Property values are narrowed by registered definitions in prepareBatch.
  return value as unknown as BrowserBatch | ServerBatch;
}
function accepts(definition: PropertyDefinition, value: unknown): boolean {
  if (definition.type === 'boolean') return typeof value === 'boolean';
  if (definition.type === 'enum') return typeof value === 'string' && definition.values.includes(value);
  return integer(value, definition.minimum, definition.maximum);
}
export async function prepareBatch(batch: BrowserBatch, registry: Registry, receivedAt: number): Promise<PreparedBatch> {
  if (batch.source !== 'browser') throw new CollectionError('invalid_request', 400);
  return { projectId: registry.project.id, schemaVersion: batch.schemaVersion, source: 'browser', receivedAt,
    events: await prepareEvents(batch, registry, receivedAt) };
}
export async function prepareServerBatch(batch: ServerBatch, registry: Registry, receivedAt: number): Promise<PreparedServerBatch> {
  if (batch.source !== 'server') throw new CollectionError('invalid_request', 400);
  const events = await prepareEvents(batch, registry, receivedAt);
  return { projectId: registry.project.id, schemaVersion: batch.schemaVersion, source: 'server', receivedAt,
    events: events.map(({ event, workflow: _workflow, ...prepared }) => ({ ...prepared,
      event: { eventId: event.eventId, name: event.name, occurredAt: event.occurredAt, properties: event.properties } })) };
}
async function prepareEvents(batch: BrowserBatch | ServerBatch, registry: Registry, receivedAt: number): Promise<PreparedEvent[]> {
  if (!Number.isSafeInteger(receivedAt)) throw Error('invalid clock');
  if (registry.project.status !== 'active') throw new CollectionError('project_unavailable', 403);
  if (registry.schemaStatus !== 'active' || registry.schemaVersion !== batch.schemaVersion) throw new CollectionError('unknown_schema', 422);
  const events: PreparedEvent[] = [];
  for (const input of batch.events) {
    if (batch.source === 'server' && has(input, 'attempt')) throw new CollectionError('invalid_event', 422);
    const definition = registry.events.find(e => e.name === input.name && e.source === batch.source);
    if (!definition) throw new CollectionError('invalid_event', 422);
    for (const [key, value] of Object.entries(input.properties)) {
      const property = has(definition.properties, key) ? definition.properties[key] : undefined;
      if (!property || !accepts(property, value)) throw new CollectionError('invalid_event', 422);
    }
    for (const [key, property] of Object.entries(definition.properties))
      if (property.required && !has(input.properties, key)) throw new CollectionError('invalid_event', 422);
    const occurredAt = utcMillis(input.occurredAt);
    if (occurredAt < receivedAt - DAY || occurredAt > receivedAt + 300_000) throw new CollectionError('invalid_event', 422);
    const event: BrowserEvent = { ...input, properties: { ...input.properties }, occurredAt: new Date(occurredAt).toISOString() };
    const prepared: PreparedEvent = { event, occurredAt, eventDate: localDate(occurredAt, registry.project.timeZone),
      dimensionKey: dimensionKey(input.properties, Object.keys(definition.properties)), payloadHash: '' };
    const workflow = batch.source === 'browser' ? registry.workflows.find(w => [w.startEvent, w.successEvent, w.failureEvent].includes(input.name)) : undefined;
    if (workflow) {
      if (!input.attempt || input.attempt.workflowId !== workflow.id) throw new CollectionError('invalid_event', 422);
      const startedAt = utcMillis(input.attempt.startedAt);
      const phase = input.name === workflow.startEvent ? 'start' : input.name === workflow.successEvent ? 'success' : 'failure';
      if (startedAt > occurredAt || occurredAt - startedAt > DAY || (phase === 'start' && startedAt !== occurredAt)) throw new CollectionError('invalid_event', 422);
      event.attempt = { ...input.attempt, startedAt: new Date(startedAt).toISOString() };
      const dimensions: Properties = Object.fromEntries(workflow.dimensions.map(key => [key, input.properties[key]!]));
      prepared.workflow = { id: workflow.id, phase, attemptId: input.attempt.attemptId, startedAt,
        cohortDate: localDate(startedAt, registry.project.timeZone), dimensionKey: dimensionKey(dimensions) };
    } else if (input.attempt) throw new CollectionError('invalid_event', 422);
    prepared.payloadHash = await sha256(canonicalEvent(registry.project.id, batch.schemaVersion, event, batch.source));
    events.push(prepared);
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt || a.event.eventId.localeCompare(b.event.eventId));
  return events;
}
