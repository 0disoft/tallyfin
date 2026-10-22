import { COLLECTION_POLICY } from './policy.ts';
import { CollectionError } from './types.ts';
import { prepareFunnelStage } from './funnel-preparation.ts';
import { failureReasonDefinition, MISSING_FAILURE_REASON_SLOT } from './workflow-failure-reasons.ts';
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
    !Array.isArray(value.events) || value.events.length < 1 || value.events.length > COLLECTION_POLICY.maxBatchEvents) throw new CollectionError('invalid_request', 400);
  const ids = new Set<string>();
  for (const event of value.events) {
    if (!closed(event, ['eventId', 'name', 'occurredAt', 'properties'], source === 'browser' ? ['attempt', 'funnel'] : ['funnel']) ||
      has(event, 'attempt') && has(event, 'funnel') || !matches(event.eventId, UUID) || !matches(event.name, NAME) ||
      !record(event.properties) || Object.keys(event.properties).length > 4) throw new CollectionError('invalid_event', 422);
    utcMillis(event.occurredAt);
    if (ids.has(event.eventId)) throw new CollectionError('invalid_event', 422);
    ids.add(event.eventId);
    if (has(event, 'attempt')) {
      if (!closed(event.attempt, ['workflowId', 'attemptId', 'startedAt']) || !matches(event.attempt.workflowId, NAME) || !matches(event.attempt.attemptId, UUID))
        throw new CollectionError('invalid_event', 422);
      utcMillis(event.attempt.startedAt);
    }
    if (has(event, 'funnel')) {
      if (!closed(event.funnel, ['funnelId', 'runId', 'startedAt']) || !matches(event.funnel.funnelId, NAME) || !matches(event.funnel.runId, UUID))
        throw new CollectionError('invalid_event', 422);
      utcMillis(event.funnel.startedAt);
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
      event: { eventId: event.eventId, name: event.name, occurredAt: event.occurredAt, properties: event.properties,
        ...(event.funnel ? { funnel: event.funnel } : {}) } })) };
}
async function prepareEvents(batch: BrowserBatch | ServerBatch, registry: Registry, receivedAt: number): Promise<PreparedEvent[]> {
  if (!Number.isSafeInteger(receivedAt)) throw Error('invalid clock');
  if (registry.project.status !== 'active') throw new CollectionError('project_unavailable', 403);
  if (registry.schemaStatus !== 'active' || registry.schemaVersion !== batch.schemaVersion) throw new CollectionError('unknown_schema', 422);
  const events: PreparedEvent[] = [];
  const definitions = new Map<string, Registry['events'][number]>();
  for (const definition of registry.events) {
    const key = `${definition.source}:${definition.name}`;
    // Preserve find()'s first-match behavior; registry validation owns duplicate rejection.
    if (!definitions.has(key)) definitions.set(key, definition);
  }
  const workflows = new Map<string, Registry['workflows'][number]>();
  for (const workflow of registry.workflows) {
    for (const name of [workflow.startEvent, workflow.successEvent, workflow.failureEvent])
      if (name !== null && !workflows.has(name)) workflows.set(name, workflow);
  }
  for (const input of batch.events) {
    if (batch.source === 'server' && has(input, 'attempt')) throw new CollectionError('invalid_event', 422);
    const definition = definitions.get(`${batch.source}:${input.name}`);
    if (!definition) throw new CollectionError('invalid_event', 422);
    for (const [key, value] of Object.entries(input.properties)) {
      const property = has(definition.properties, key) ? definition.properties[key] : undefined;
      if (!property || !accepts(property, value)) throw new CollectionError('invalid_event', 422);
    }
    for (const [key, property] of Object.entries(definition.properties))
      if (property.required && !has(input.properties, key)) throw new CollectionError('invalid_event', 422);
    const occurredAt = utcMillis(input.occurredAt);
    if (occurredAt < receivedAt - COLLECTION_POLICY.maxEventAgeMs || occurredAt > receivedAt + COLLECTION_POLICY.maxFutureSkewMs) throw new CollectionError('invalid_event', 422);
    const event: BrowserEvent = { ...input, properties: { ...input.properties }, occurredAt: new Date(occurredAt).toISOString() };
    const prepared: PreparedEvent = { event, occurredAt, eventDate: localDate(occurredAt, registry.project.timeZone),
      dimensionKey: dimensionKey(input.properties, Object.keys(definition.properties)), payloadHash: '' };
    if (has(input, 'attempt') && has(input, 'funnel')) throw new CollectionError('invalid_event', 422);
    const workflow = batch.source === 'browser' && !has(input, 'funnel') ? workflows.get(input.name) : undefined;
    if (workflow) {
      if (!input.attempt || input.attempt.workflowId !== workflow.id) throw new CollectionError('invalid_event', 422);
      const startedAt = utcMillis(input.attempt.startedAt);
      const phase = input.name === workflow.startEvent ? 'start' : input.name === workflow.successEvent ? 'success' : 'failure';
      if (startedAt > occurredAt || occurredAt - startedAt > COLLECTION_POLICY.taskWindowMs || (phase === 'start' && startedAt !== occurredAt)) throw new CollectionError('invalid_event', 422);
      event.attempt = { ...input.attempt, startedAt: new Date(startedAt).toISOString() };
      const dimensions: Properties = Object.fromEntries(workflow.dimensions.map(key => [key, input.properties[key]!]));
      prepared.workflow = { id: workflow.id, phase, attemptId: input.attempt.attemptId, startedAt,
        cohortDate: localDate(startedAt, registry.project.timeZone), dimensionKey: dimensionKey(dimensions) };
      if (phase === 'failure' && workflow.failureReasonProperty !== undefined) {
        const reason = failureReasonDefinition(registry, workflow)!;
        prepared.workflow.failureReasonSlot = has(input.properties, reason.property)
          ? reason.values.indexOf(input.properties[reason.property] as string) : MISSING_FAILURE_REASON_SLOT;
      }
    } else if (input.attempt) throw new CollectionError('invalid_event', 422);
    if (has(input, 'funnel')) {
      prepared.funnel = prepareFunnelStage(prepared, registry, batch.source, receivedAt);
      event.funnel = prepared.funnel.event.funnel;
    }
    prepared.payloadHash = await sha256(canonicalEvent(registry.project.id, batch.schemaVersion, event, batch.source));
    if (prepared.funnel) prepared.funnel.payloadHash = prepared.payloadHash;
    events.push(prepared);
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt || a.event.eventId.localeCompare(b.event.eventId));
  return events;
}
