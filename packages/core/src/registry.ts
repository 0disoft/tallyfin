import type { PropertyDefinition, Registry } from './types.ts';
import { validateMutableSettings } from './settings.ts';
import { closed, ENUM_VALUE, has, integer, matches, NAME, PROJECT_ID, record, text } from './value.ts';

function cardinality(definition: unknown): number {
  if (!record(definition) || typeof definition.required !== 'boolean' || !text(definition.purpose, 1, 240)) throw Error('invalid registry');
  let count: number;
  if (definition.type === 'boolean' && closed(definition, ['type', 'required', 'purpose'])) count = 2;
  else if (definition.type === 'enum' && closed(definition, ['type', 'required', 'purpose', 'values']) &&
    Array.isArray(definition.values) && definition.values.length >= 1 && definition.values.length <= 32 &&
    definition.values.every(v => matches(v, ENUM_VALUE)) && new Set(definition.values).size === definition.values.length) count = definition.values.length;
  else if (definition.type === 'integer' && closed(definition, ['type', 'required', 'purpose', 'minimum', 'maximum']) &&
    integer(definition.minimum, -1_000_000, 1_000_000) && integer(definition.maximum, -1_000_000, 1_000_000)) count = definition.maximum - definition.minimum + 1;
  else throw Error('invalid registry');
  if (count < 1 || count > 32) throw Error('invalid registry');
  return count + (definition.required ? 0 : 1);
}
function signature(definition: PropertyDefinition): string {
  return JSON.stringify(definition.type === 'enum' ? ['enum', [...definition.values].sort()] :
    definition.type === 'integer' ? ['integer', definition.minimum, definition.maximum] : ['boolean']);
}
export function validateRegistry(value: unknown, options: { allowLocalHttp?: boolean } = {}): Registry {
  if (!closed(value, ['project', 'schemaVersion', 'schemaStatus', 'allowedOrigins', 'limits', 'events', 'workflows']) ||
    !closed(value.project, ['id', 'name', 'status', 'timeZone']) || !matches(value.project.id, PROJECT_ID) ||
    !text(value.project.name, 1, 80) || !['active', 'paused'].includes(String(value.project.status)) || !text(value.project.timeZone, 1, 64) ||
    !integer(value.schemaVersion, 1, 2_147_483_647) || !['active', 'retired'].includes(String(value.schemaStatus)) ||
    !closed(value.limits, ['requestsPerMinute', 'newReceiptsPerUtcDay']) || !integer(value.limits.requestsPerMinute, 1, 600) ||
    !integer(value.limits.newReceiptsPerUtcDay, 1, 1_000_000)) throw Error('invalid registry');
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value.project.timeZone)) throw Error('invalid registry');
  new Intl.DateTimeFormat('en', { timeZone: value.project.timeZone });
  validateMutableSettings({ name: value.project.name, status: value.project.status,
    allowedOrigins: value.allowedOrigins, limits: value.limits }, options);
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > 50 ||
    !Array.isArray(value.workflows) || value.workflows.length > 10 ||
    new TextEncoder().encode(JSON.stringify({ events: value.events, workflows: value.workflows })).byteLength > 32 * 1024) throw Error('invalid registry');
  const names = new Set<string>();
  for (const event of value.events) {
    if (!closed(event, ['name', 'label', 'source', 'properties']) || !matches(event.name, NAME) || names.has(event.name) ||
      !text(event.label, 1, 80) || !['browser', 'server'].includes(String(event.source)) || !record(event.properties) || Object.keys(event.properties).length > 4)
      throw Error('invalid registry');
    names.add(event.name);
    let combinations = 1;
    for (const [key, definition] of Object.entries(event.properties)) {
      if (!matches(key, NAME)) throw Error('invalid registry');
      combinations *= cardinality(definition);
    }
    if (combinations > 256) throw Error('invalid registry');
  }
  // Shape checks above establish the public Registry type before cross-reference checks.
  const registry = value as unknown as Registry;
  if (!registry.events.some(e => e.source === 'browser')) throw Error('invalid registry');
  const bound = new Set<string>(); const workflows = new Set<string>();
  for (const workflow of registry.workflows) {
    if (!closed(workflow, ['id', 'label', 'source', 'startEvent', 'successEvent', 'failureEvent', 'dimensions']) ||
      !matches(workflow.id, NAME) || workflows.has(workflow.id) || !text(workflow.label, 1, 80) || workflow.source !== 'browser' ||
      !Array.isArray(workflow.dimensions) || workflow.dimensions.length > 4 || !workflow.dimensions.every(key => matches(key, NAME)) ||
      new Set(workflow.dimensions).size !== workflow.dimensions.length) throw Error('invalid registry');
    workflows.add(workflow.id);
    const phases = [workflow.startEvent, workflow.successEvent, ...(workflow.failureEvent === null ? [] : [workflow.failureEvent])];
    if (new Set(phases).size !== phases.length) throw Error('invalid registry');
    const definitions = phases.map(name => {
      if (!matches(name, NAME) || bound.has(name)) throw Error('invalid registry');
      bound.add(name);
      const event = registry.events.find(e => e.name === name && e.source === workflow.source);
      if (!event) throw Error('invalid registry');
      return event;
    });
    for (const key of workflow.dimensions) {
      let expected: string | undefined;
      for (const event of definitions) {
        const definition = has(event.properties, key) ? event.properties[key] : undefined;
        if (!definition?.required) throw Error('invalid registry');
        const actual = signature(definition);
        if (expected !== undefined && actual !== expected) throw Error('invalid registry');
        expected = actual;
      }
    }
  }
  // Registration still requires the owner's privacy review; syntax cannot detect private enums.
  return structuredClone(registry);
}
