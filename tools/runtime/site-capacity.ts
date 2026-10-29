import { MAX_PUBLICATION_BYTES, MAX_SCHEMA_BYTES, SCHEMA_LIMITS } from '@tallyfin/core';
import type { EventDefinition } from '@tallyfin/core';

export const FAILURE_REASONS = ['validation', 'unsupported', 'dependency', 'timeout', 'other'];
type CapacityIssue = { resource: string; actual: number; limit: number; factors?: Record<string, number> };
export class SiteCapacityError extends Error {
  readonly capacity: CapacityIssue;
  constructor(capacity: CapacityIssue) {
    super(`Site capacity exceeded: ${capacity.resource} needs ${capacity.actual}, limit ${capacity.limit}`);
    this.name = 'SiteCapacityError';
    this.capacity = capacity;
  }
}
function check(resource: string, actual: number, limit: number, factors?: Record<string, number>) {
  if (actual > limit) throw new SiteCapacityError({ resource, actual, limit, ...(factors ? { factors } : {}) });
}

/** Whitespace must not make an otherwise valid request file exceed the API body limit. */
export function siteRequestJson(value: unknown, limit: number = MAX_SCHEMA_BYTES): string {
  const pretty = JSON.stringify(value, null, 2) + '\n';
  return new TextEncoder().encode(pretty).byteLength <= limit ? pretty : JSON.stringify(value) + '\n';
}

/** Partition only previously over-budget inputs; valid existing schemas keep their identifiers. */
export function siteToolGroups(locales: number, pages: number, tools: readonly string[]) {
  check('page_view combinations', locales * pages, SCHEMA_LIMITS.combinations, { locale: locales, page: pages });
  const toolsPerGroup = Math.floor(SCHEMA_LIMITS.combinations / (locales * FAILURE_REASONS.length));
  const count = Math.ceil(tools.length / toolsPerGroup);
  check('workflows', count, SCHEMA_LIMITS.workflows, { locale: locales, tool: tools.length, toolsPerGroup });
  check('events', 2 + 3 * count, SCHEMA_LIMITS.events);
  return Array.from({ length: count }, (_, index) => {
    const suffix = index === 0 ? '' : `_${index + 1}`;
    return { workflowId: `tool_usage${suffix}`, tools: tools.slice(index * toolsPerGroup, (index + 1) * toolsPerGroup),
      startEvent: `tool_started${suffix}`, successEvent: `tool_succeeded${suffix}`, failureEvent: `tool_failed${suffix}` };
  });
}

export function siteCapacity(events: EventDefinition[], workflowCount: number, definitions: unknown, requested: { locales: number; tools: number }) {
  const bytes = new TextEncoder().encode(JSON.stringify(definitions)).byteLength;
  check('schema bytes', bytes, MAX_SCHEMA_BYTES);
  const schemaDraftBytes = new TextEncoder().encode(siteRequestJson(definitions)).byteLength;
  const schemaPublicationBytes = new TextEncoder().encode(siteRequestJson({ ...(definitions as object), expectedLatestVersion: null, privacyReviewed: false }, MAX_PUBLICATION_BYTES)).byteLength;
  check('schema draft file bytes', schemaDraftBytes, MAX_SCHEMA_BYTES);
  check('schema publication file bytes', schemaPublicationBytes, MAX_PUBLICATION_BYTES);
  return { schemaVersion: 'tallyfin.site-capacity/v1', limits: { combinationsPerEvent: SCHEMA_LIMITS.combinations,
    events: SCHEMA_LIMITS.events, workflows: SCHEMA_LIMITS.workflows, schemaBytes: MAX_SCHEMA_BYTES, publicationBytes: MAX_PUBLICATION_BYTES },
    eventCount: events.length, workflowCount, schemaBytes: bytes, schemaDraftBytes, schemaPublicationBytes,
    requestedFailureCombinations: requested.locales * requested.tools * FAILURE_REASONS.length,
    events: events.map(event => {
      const factors = Object.fromEntries(Object.entries(event.properties).map(([name, definition]) => {
        if (definition.type !== 'enum') throw Error('Site properties must be enums');
        return [name, definition.values!.length];
      }));
      const combinations = Object.values(factors).reduce((product, count) => product * count, 1);
      check(`${event.name} combinations`, combinations, SCHEMA_LIMITS.combinations, factors);
      return { name: event.name, combinations, factors };
    }) };
}
