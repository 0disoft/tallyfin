import type { EventDefinition, PropertyDefinition, Registry } from './types.ts';
import { closed, ENUM_VALUE, has, integer, matches, NAME, record, text } from './value.ts';

export const MAX_SCHEMA_BYTES = 32 * 1024;
// browser_event_required remains a legacy wire code; current schemas may be server-only.
export type SchemaIssueCode = 'invalid_definition' | 'definition_limit' | 'duplicate' | 'cardinality_limit' |
  'browser_event_required' | 'invalid_reference' | 'dimension_mismatch';
export interface SchemaIssue { path: string; code: SchemaIssueCode }
export interface SchemaValidation { valid: boolean; issues: SchemaIssue[]; privacyReviewRequired: true }
export type SchemaDefinitions = Pick<Registry, 'events' | 'workflows'>;
export class SchemaDefinitionError extends Error {
  readonly issue: SchemaIssue;
  constructor(path: string, code: SchemaIssueCode) {
    super('invalid registry'); this.name = 'SchemaDefinitionError'; this.issue = { path, code };
  }
}
function fail(path: string, code: SchemaIssueCode = 'invalid_definition'): never { throw new SchemaDefinitionError(path, code); }
function cardinality(definition: unknown, path: string): number {
  if (!record(definition) || typeof definition.required !== 'boolean' || !text(definition.purpose, 1, 240)) fail(path);
  let count: number;
  if (definition.type === 'boolean' && closed(definition, ['type', 'required', 'purpose'])) count = 2;
  else if (definition.type === 'enum' && closed(definition, ['type', 'required', 'purpose', 'values']) &&
    Array.isArray(definition.values) && definition.values.length >= 1 && definition.values.length <= 32 &&
    definition.values.every(v => matches(v, ENUM_VALUE)) && new Set(definition.values).size === definition.values.length) count = definition.values.length;
  else if (definition.type === 'integer' && closed(definition, ['type', 'required', 'purpose', 'minimum', 'maximum']) &&
    integer(definition.minimum, -1_000_000, 1_000_000) && integer(definition.maximum, -1_000_000, 1_000_000)) count = definition.maximum - definition.minimum + 1;
  else fail(path);
  if (count < 1 || count > 32) fail(path, 'cardinality_limit');
  return count + (definition.required ? 0 : 1);
}
function signature(definition: PropertyDefinition): string {
  return JSON.stringify(definition.type === 'enum' ? ['enum', [...definition.values].sort()] :
    definition.type === 'integer' ? ['integer', definition.minimum, definition.maximum] : ['boolean']);
}
/** Shared by registration and draft validation: passing a draft never relaxes registry rules. */
export function validateSchemaDefinitions(value: unknown): void {
  if (!closed(value, ['events', 'workflows'])) fail('');
  if (!Array.isArray(value.events)) fail('/events');
  if (!Array.isArray(value.workflows)) fail('/workflows');
  if (value.events.length < 1 || value.events.length > 50) fail('/events', 'definition_limit');
  if (value.workflows.length > 10) fail('/workflows', 'definition_limit');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_SCHEMA_BYTES) fail('', 'definition_limit');
  const names = new Set<string>();
  for (const [index, event] of value.events.entries()) {
    const path = `/events/${index}`;
    if (!closed(event, ['name', 'label', 'source', 'properties']) || !matches(event.name, NAME) ||
      !text(event.label, 1, 80) || (event.source !== 'browser' && event.source !== 'server') || !record(event.properties) || Object.keys(event.properties).length > 4)
      fail(path);
    if (names.has(event.name)) fail(`${path}/name`, 'duplicate');
    names.add(event.name);
    let combinations = 1;
    for (const [key, definition] of Object.entries(event.properties)) {
      if (!NAME.test(key)) fail(`${path}/properties`);
      combinations *= cardinality(definition, `${path}/properties/${key}`);
    }
    if (combinations > 256) fail(`${path}/properties`, 'cardinality_limit');
  }
  const definitions = value as unknown as SchemaDefinitions;
  const bound = new Set<string>(); const workflows = new Set<string>();
  for (const [index, workflow] of definitions.workflows.entries()) {
    const path = `/workflows/${index}`;
    if (!closed(workflow, ['id', 'label', 'source', 'startEvent', 'successEvent', 'failureEvent', 'dimensions']) ||
      !matches(workflow.id, NAME) || !text(workflow.label, 1, 80) || workflow.source !== 'browser' ||
      !Array.isArray(workflow.dimensions) || workflow.dimensions.length > 4 || !workflow.dimensions.every(key => matches(key, NAME)) ||
      new Set(workflow.dimensions).size !== workflow.dimensions.length) fail(path);
    if (workflows.has(workflow.id)) fail(`${path}/id`, 'duplicate');
    workflows.add(workflow.id);
    const phases: ('startEvent' | 'successEvent' | 'failureEvent')[] = ['startEvent', 'successEvent'];
    if (workflow.failureEvent !== null) phases.push('failureEvent');
    const events: EventDefinition[] = [];
    for (const phase of phases) {
      const name = workflow[phase];
      if (!matches(name, NAME) || bound.has(name)) fail(`${path}/${phase}`, 'invalid_reference');
      bound.add(name);
      const event = definitions.events.find(e => e.name === name && e.source === workflow.source);
      if (!event) fail(`${path}/${phase}`, 'invalid_reference');
      events.push(event);
    }
    for (const [dimensionIndex, key] of workflow.dimensions.entries()) {
      let expected: string | undefined;
      for (const event of events) {
        const definition = has(event.properties, key) ? event.properties[key] : undefined;
        if (!definition?.required) fail(`${path}/dimensions/${dimensionIndex}`, 'dimension_mismatch');
        const actual = signature(definition);
        if (expected !== undefined && actual !== expected) fail(`${path}/dimensions/${dimensionIndex}`, 'dimension_mismatch');
        expected = actual;
      }
    }
  }
}
/** Reports only the first issue; syntax validation cannot approve private enum contents. */
export function validateSchemaDraft(value: unknown): SchemaValidation {
  try { validateSchemaDefinitions(value); return { valid: true, issues: [], privacyReviewRequired: true }; }
  catch (error) {
    if (!(error instanceof SchemaDefinitionError)) throw error;
    return { valid: false, issues: [error.issue], privacyReviewRequired: true };
  }
}
