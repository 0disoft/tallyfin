import { CollectionError } from './types.ts';
import type { BrowserEvent, EventDefinition, EventSource, Registry } from './types.ts';
import { parseBatch, parseServerBatch, prepareBatch, prepareServerBatch } from './batch.ts';
import { count } from './query.ts';
import { SchemaDefinitionError, MAX_SCHEMA_BYTES, validateSchemaDefinitions } from './schema.ts';
import { closed, DAY, dimensionKey, has, integer, localDate, matches, NAME, sha256, text, utcMillis, UUID } from './value.ts';

export interface FunnelDefinition {
  id: string; label: string; steps: { eventName: string; source: EventSource }[]; dimensions: string[];
}
/** One random task identity, not a visitor identity, credential or proof of a browser event. */
export interface FunnelLink { funnelId: string; runId: string; startedAt: string }
export interface FunnelEvent extends Omit<BrowserEvent, 'attempt'> { funnel: FunnelLink; attempt?: never }
export interface PreparedFunnelObservation {
  projectId: string; schemaVersion: number; source: EventSource; receivedAt: number;
  event: FunnelEvent; eventDate: string; eventDimensionKey: string; payloadHash: string;
  stepIndex: number; stepCount: number; startedAt: number; occurredAt: number;
  cohortDate: string; dimensionKey: string;
}
/** Temporary linkage only; a storage adapter must persist this and its deltas atomically. */
export interface FunnelRunState {
  projectId: string; schemaVersion: number; funnelId: string; runId: string; startedAt: number;
  cohortDate: string; dimensionKey: string; stepTimes: (number | null)[]; expiresAt: number;
}
export interface FunnelDelta {
  cohortDate: string; funnelId: string; dimensionKey: string; stepIndex: number; reachedCount: 1;
}
export interface FunnelProgress { state: FunnelRunState; deltas: FunnelDelta[]; duplicate: boolean }

function invalidDefinition(path: string, code: import('./schema.ts').SchemaIssueCode = 'invalid_definition'): never {
  throw new SchemaDefinitionError(path, code);
}
function propertyDomain(property: import('./types.ts').PropertyDefinition): string {
  return JSON.stringify(property.type === 'enum' ? ['enum', [...property.values].sort()] :
    property.type === 'integer' ? ['integer', property.minimum, property.maximum] : ['boolean']);
}
/** Standalone validation until versioned schema publication is extended to carry funnels. */
export function validateFunnelDefinitions(value: unknown, events: EventDefinition[]): asserts value is FunnelDefinition[] {
  validateSchemaDefinitions({ events, workflows: [] });
  if (!Array.isArray(value) || value.length > 10) invalidDefinition('/funnels', 'definition_limit');
  if (new TextEncoder().encode(JSON.stringify({ events, workflows: [], funnels: value })).byteLength > MAX_SCHEMA_BYTES)
    invalidDefinition('/funnels', 'definition_limit');
  const ids = new Set<string>();
  for (const [index, definition] of value.entries()) {
    const path = `/funnels/${index}`;
    if (!closed(definition, ['id', 'label', 'steps', 'dimensions']) || !matches(definition.id, NAME) || !text(definition.label, 1, 80) ||
      !Array.isArray(definition.steps) || definition.steps.length < 2 || definition.steps.length > 10 ||
      !Array.isArray(definition.dimensions) || definition.dimensions.length > 4 || !definition.dimensions.every(key => matches(key, NAME)) ||
      new Set(definition.dimensions).size !== definition.dimensions.length) invalidDefinition(path);
    if (ids.has(definition.id)) invalidDefinition(`${path}/id`, 'duplicate');
    ids.add(definition.id);
    const names = new Set<string>(); const stages: EventDefinition[] = [];
    for (const [stepIndex, step] of definition.steps.entries()) {
      const stepPath = `${path}/steps/${stepIndex}`;
      if (!closed(step, ['eventName', 'source']) || !matches(step.eventName, NAME) || (step.source !== 'browser' && step.source !== 'server'))
        invalidDefinition(stepPath);
      if (names.has(step.eventName)) invalidDefinition(`${stepPath}/eventName`, 'duplicate');
      names.add(step.eventName);
      const event = events.find(event => event.name === step.eventName && event.source === step.source);
      if (!event) invalidDefinition(stepPath, 'invalid_reference');
      stages.push(event);
    }
    for (const [dimensionIndex, key] of definition.dimensions.entries()) {
      let expected: string | undefined;
      for (const stage of stages) {
        const property = has(stage.properties, key) ? stage.properties[key] : undefined;
        if (!property?.required) invalidDefinition(`${path}/dimensions/${dimensionIndex}`, 'dimension_mismatch');
        const domain = propertyDomain(property);
        if (expected !== undefined && expected !== domain) invalidDefinition(`${path}/dimensions/${dimensionIndex}`, 'dimension_mismatch');
        expected = domain;
      }
    }
  }
}

/** Uses validated registry/definition; the host must enforce origins or verified publisher permission. */
export async function prepareFunnelObservation(input: unknown, registry: Registry, definition: FunnelDefinition,
  source: EventSource, receivedAt: number): Promise<PreparedFunnelObservation> {
  if ((source !== 'browser' && source !== 'server') || !integer(receivedAt, 0, 8_640_000_000_000_000))
    throw new CollectionError('invalid_request', 400);
  if (!closed(input, ['eventId', 'name', 'occurredAt', 'properties', 'funnel']) ||
    !closed(input.funnel, ['funnelId', 'runId', 'startedAt']) || input.funnel.funnelId !== definition.id || !matches(input.funnel.runId, UUID))
    throw new CollectionError('invalid_event', 422);
  const stepIndex = definition.steps.findIndex(step => step.eventName === input.name && step.source === source);
  if (stepIndex < 0) throw new CollectionError('invalid_event', 422);
  // Reuse the actual property, timestamp, project and schema checks without treating a funnel as a legacy workflow.
  const { funnel: _link, ...ordinary } = input;
  const body = JSON.stringify({ schemaVersion: registry.schemaVersion, source, events: [ordinary] });
  const plainRegistry = { ...registry, workflows: [] };
  const prepared = source === 'browser' ? (await prepareBatch(parseBatch(body), plainRegistry, receivedAt)).events[0]! :
    (await prepareServerBatch(parseServerBatch(body), plainRegistry, receivedAt)).events[0]!;
  const startedAt = utcMillis(input.funnel.startedAt);
  if (startedAt > prepared.occurredAt || prepared.occurredAt - startedAt > DAY || (stepIndex === 0 && startedAt !== prepared.occurredAt))
    throw new CollectionError('invalid_event', 422);
  const event: FunnelEvent = { eventId: prepared.event.eventId, name: prepared.event.name, properties: prepared.event.properties,
    occurredAt: prepared.event.occurredAt, funnel: { funnelId: definition.id, runId: input.funnel.runId,
    startedAt: new Date(startedAt).toISOString() } };
  const dimensions = dimensionKey(event.properties, definition.dimensions);
  const payloadHash = await sha256(JSON.stringify(['funnel-v1', registry.project.id, registry.schemaVersion, source,
    event.eventId, event.name, event.occurredAt, dimensionKey(event.properties), event.funnel.funnelId, event.funnel.runId, event.funnel.startedAt]));
  return { projectId: registry.project.id, schemaVersion: registry.schemaVersion, source, receivedAt, event,
    eventDate: prepared.eventDate, eventDimensionKey: prepared.dimensionKey, payloadHash, stepIndex, stepCount: definition.steps.length,
    startedAt, occurredAt: prepared.occurredAt, cohortDate: localDate(startedAt, registry.project.timeZone), dimensionKey: dimensions };
}

const prefixLength = (times: (number | null)[]): number => {
  const missing = times.indexOf(null); return missing === -1 ? times.length : missing;
};
function orderedTimes(times: (number | null)[], startedAt: number): boolean {
  let previous = startedAt;
  return times.every((time, index) => {
    if (time === null) return true;
    if (!integer(time, startedAt, startedAt + DAY) || time < previous || (index === 0 && time !== startedAt)) return false;
    previous = time; return true;
  });
}
/** Call only after project/source event receipt deduplication, within the ingestion transaction. */
export function planFunnelProgress(observation: PreparedFunnelObservation, previous: FunnelRunState | null): FunnelProgress {
  if (previous && (!integer(previous.startedAt, 0, 8_640_000_000_000_000 - 3 * DAY) ||
    previous.expiresAt !== previous.startedAt + 3 * DAY || !Array.isArray(previous.stepTimes) ||
    previous.stepTimes.length < 2 || previous.stepTimes.length > 10 || !orderedTimes(previous.stepTimes, previous.startedAt)))
    throw new CollectionError('storage_unavailable', 503);
  const active = previous && previous.expiresAt > observation.receivedAt ? previous : null;
  if (active && (active.projectId !== observation.projectId || active.schemaVersion !== observation.schemaVersion ||
    active.funnelId !== observation.event.funnel.funnelId || active.runId !== observation.event.funnel.runId ||
    active.startedAt !== observation.startedAt || active.cohortDate !== observation.cohortDate ||
    active.dimensionKey !== observation.dimensionKey || active.stepTimes.length !== observation.stepCount))
    throw new CollectionError('attempt_conflict', 409);
  const state: FunnelRunState = active ? { ...active, stepTimes: [...active.stepTimes] } : {
    projectId: observation.projectId, schemaVersion: observation.schemaVersion, funnelId: observation.event.funnel.funnelId,
    runId: observation.event.funnel.runId, startedAt: observation.startedAt, cohortDate: observation.cohortDate,
    dimensionKey: observation.dimensionKey, stepTimes: Array<number | null>(observation.stepCount).fill(null), expiresAt: observation.startedAt + 3 * DAY,
  };
  const before = prefixLength(state.stepTimes);
  const seenAt = state.stepTimes[observation.stepIndex]!;
  if (seenAt !== null && seenAt !== observation.occurredAt) throw new CollectionError('attempt_conflict', 409);
  if (seenAt !== null) return { state, deltas: [], duplicate: true };
  state.stepTimes[observation.stepIndex] = observation.occurredAt;
  if (!orderedTimes(state.stepTimes, state.startedAt)) throw new CollectionError('attempt_conflict', 409);
  const after = prefixLength(state.stepTimes);
  const deltas: FunnelDelta[] = Array.from({ length: after - before }, (_, offset) => ({ cohortDate: state.cohortDate,
    funnelId: state.funnelId, dimensionKey: state.dimensionKey, stepIndex: before + offset, reachedCount: 1 }));
  return { state, deltas, duplicate: false };
}

/** Missing future steps include active and undelivered tasks; they are not proof of abandonment. */
export function funnelCounts(reached: number[]) {
  if (!Array.isArray(reached) || reached.length < 2 || reached.length > 10) throw new CollectionError('storage_unavailable', 503);
  reached.forEach((value, index) => {
    count(value);
    if (index > 0 && value > reached[index - 1]!) throw new CollectionError('storage_unavailable', 503);
  });
  const started = reached[0]!, completed = reached.at(-1)!;
  return { startedRuns: started, completedRuns: completed, completionRate: started ? completed / started * 100 : null,
    steps: reached.map((value, index) => ({ stepIndex: index, reachedRuns: value, reachRate: started ? value / started * 100 : null,
      conversionRate: index > 0 && reached[index - 1]! > 0 ? value / reached[index - 1]! * 100 : null,
      notReachedNext: index + 1 < reached.length ? value - reached[index + 1]! : null })) };
}
