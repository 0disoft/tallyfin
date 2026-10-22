import { SCHEMA_LIMITS } from './policy.ts';
import type { EventDefinition, FunnelDefinition, PropertyDefinition, Registry } from './types.ts';
import { closed, ENUM_VALUE, has, integer, matches, NAME, record, text } from './value.ts';

export const MAX_SCHEMA_BYTES = 32 * 1024;
// browser_event_required remains a legacy wire code; current schemas may be server-only.
export type SchemaIssueCode = 'invalid_definition' | 'definition_limit' | 'duplicate' | 'cardinality_limit' |
  'browser_event_required' | 'invalid_reference' | 'dimension_mismatch';
export interface SchemaIssue { path: string; code: SchemaIssueCode }
export interface SchemaValidation { valid: boolean; issues: SchemaIssue[]; privacyReviewRequired: true }
export type SchemaDefinitions = Pick<Registry, 'events' | 'workflows' | 'funnels'>;
type Borrowed<T> = T extends readonly (infer Item)[] ? readonly Borrowed<Item>[] :
  T extends object ? { readonly [Key in keyof T]: Borrowed<T[Key]> } : T;
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
    Array.isArray(definition.values) && definition.values.length >= 1 && definition.values.length <= SCHEMA_LIMITS.values &&
    definition.values.every(v => matches(v, ENUM_VALUE)) && new Set(definition.values).size === definition.values.length) count = definition.values.length;
  else if (definition.type === 'integer' && closed(definition, ['type', 'required', 'purpose', 'minimum', 'maximum']) &&
    integer(definition.minimum, -1_000_000, 1_000_000) && integer(definition.maximum, -1_000_000, 1_000_000)) count = definition.maximum - definition.minimum + 1;
  else fail(path);
  if (count < 1 || count > SCHEMA_LIMITS.values) fail(path, 'cardinality_limit');
  return count + (definition.required ? 0 : 1);
}
function signature(definition: PropertyDefinition): string {
  return JSON.stringify(definition.type === 'enum' ? ['enum', [...definition.values].sort()] :
    definition.type === 'integer' ? ['integer', definition.minimum, definition.maximum] : ['boolean']);
}
/** Shared by registration and draft validation: passing a draft never relaxes registry rules. */
export function validateSchemaDefinitions(value: unknown): void {
  if (!closed(value, ['events', 'workflows'], ['funnels'])) fail('');
  if (!Array.isArray(value.events)) fail('/events');
  if (!Array.isArray(value.workflows)) fail('/workflows');
  if (value.events.length < 1 || value.events.length > SCHEMA_LIMITS.events) fail('/events', 'definition_limit');
  if (value.workflows.length > SCHEMA_LIMITS.workflows) fail('/workflows', 'definition_limit');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_SCHEMA_BYTES) fail('', 'definition_limit');
  validateEvents(value.events);
  const definitions = value as unknown as SchemaDefinitions;
  validateWorkflows(definitions);
  if (has(value, 'funnels')) validateFunnels(value.funnels, definitions.events);
}
function validateEvents(events: EventDefinition[]): void {
  const names = new Set<string>();
  for (const [index, event] of events.entries()) {
    const path = `/events/${index}`;
    if (!closed(event, ['name', 'label', 'source', 'properties']) || !matches(event.name, NAME) ||
      !text(event.label, 1, 80) || (event.source !== 'browser' && event.source !== 'server') || !record(event.properties) || Object.keys(event.properties).length > SCHEMA_LIMITS.properties)
      fail(path);
    if (names.has(event.name)) fail(`${path}/name`, 'duplicate');
    names.add(event.name);
    let combinations = 1;
    for (const [key, definition] of Object.entries(event.properties)) {
      if (!NAME.test(key)) fail(`${path}/properties`);
      combinations *= cardinality(definition, `${path}/properties/${key}`);
    }
    if (combinations > SCHEMA_LIMITS.combinations) fail(`${path}/properties`, 'cardinality_limit');
  }
}

function validateDimensions(dimensions: string[], events: EventDefinition[], path: string): void {
  const domains = events.map(event => event.properties);
  for (const [index, key] of dimensions.entries()) {
    let expected: string | undefined;
    for (const properties of domains) {
      const definition = has(properties, key) ? properties[key] : undefined;
      if (!definition?.required) fail(`${path}/dimensions/${index}`, 'dimension_mismatch');
      const actual = signature(definition);
      if (expected !== undefined && actual !== expected) fail(`${path}/dimensions/${index}`, 'dimension_mismatch');
      expected = actual;
    }
  }
}

function validateWorkflows(definitions: SchemaDefinitions): void {
  const bound = new Set<string>(); const workflows = new Set<string>();
  for (const [index, workflow] of definitions.workflows.entries()) {
    const path = `/workflows/${index}`;
    if (!closed(workflow, ['id', 'label', 'source', 'startEvent', 'successEvent', 'failureEvent', 'dimensions']) ||
      !matches(workflow.id, NAME) || !text(workflow.label, 1, 80) || workflow.source !== 'browser' ||
      !Array.isArray(workflow.dimensions) || workflow.dimensions.length > SCHEMA_LIMITS.dimensions || !workflow.dimensions.every(key => matches(key, NAME)) ||
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
    validateDimensions(workflow.dimensions, events, path);
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

/** Events and the combined definition budget have already been validated above. */
function validateFunnels(value: unknown, events: EventDefinition[]): asserts value is FunnelDefinition[] {
  if (!Array.isArray(value) || value.length > SCHEMA_LIMITS.funnels) fail('/funnels', 'definition_limit');
  const ids = new Set<string>();
  for (const [index, definition] of value.entries()) {
    const path = `/funnels/${index}`;
    if (!closed(definition, ['id', 'label', 'steps', 'dimensions']) || !matches(definition.id, NAME) || !text(definition.label, 1, 80) ||
      !Array.isArray(definition.steps) || definition.steps.length < SCHEMA_LIMITS.minSteps || definition.steps.length > SCHEMA_LIMITS.maxSteps ||
      !Array.isArray(definition.dimensions) || definition.dimensions.length > SCHEMA_LIMITS.dimensions || !definition.dimensions.every(key => matches(key, NAME)) ||
      new Set(definition.dimensions).size !== definition.dimensions.length) fail(path);
    if (ids.has(definition.id)) fail(`${path}/id`, 'duplicate');
    ids.add(definition.id);
    const names = new Set<string>(); const stages: EventDefinition[] = [];
    for (const [stepIndex, step] of definition.steps.entries()) {
      const stepPath = `${path}/steps/${stepIndex}`;
      if (!closed(step, ['eventName', 'source']) || !matches(step.eventName, NAME) || (step.source !== 'browser' && step.source !== 'server'))
        fail(stepPath);
      if (names.has(step.eventName)) fail(`${stepPath}/eventName`, 'duplicate');
      names.add(step.eventName);
      const event = events.find(event => event.name === step.eventName && event.source === step.source);
      if (!event) fail(stepPath, 'invalid_reference');
      stages.push(event);
    }
    validateDimensions(definition.dimensions, stages, path);
  }
}

export function validateFunnelDefinitions(value: unknown, events: EventDefinition[]): asserts value is FunnelDefinition[] {
  validateSchemaDefinitions({ events, workflows: [], funnels: value });
}
/** Borrowed read-only view. Preserve absent fields and existing publication hashes without another deep copy. */
export function schemaDefinitions(value: SchemaDefinitions): Borrowed<SchemaDefinitions> {
  return { events: value.events, workflows: value.workflows, ...(has(value, 'funnels') ? { funnels: value.funnels! } : {}) };
}
