import { validateRegistry } from '../../packages/core/src/index.ts';

/** Build-time only. The SDK never imports the full registry validator or server definitions. */
export function projectBrowserSchema(input) {
  const registry = validateRegistry(input);
  if (registry.project.status !== 'active' || registry.schemaStatus !== 'active') throw Error('inactive browser schema');
  const rule = definition => definition.type === 'boolean' ? ['boolean', definition.required] : definition.type === 'enum'
    ? ['enum', definition.required, definition.values] : ['integer', definition.required, definition.minimum, definition.maximum];
  return {
    version: registry.schemaVersion,
    events: Object.fromEntries(registry.events.filter(event => event.source === 'browser').map(event => [event.name,
      Object.fromEntries(Object.entries(event.properties).map(([key, definition]) => [key, rule(definition)]))])),
    workflows: Object.fromEntries(registry.workflows.map(workflow => [workflow.id, {
      start: workflow.startEvent, success: workflow.successEvent,
      ...(workflow.failureEvent === null ? {} : { failure: workflow.failureEvent }), dimensions: workflow.dimensions,
    }])),
  };
}
