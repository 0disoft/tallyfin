import { validateRegistry } from '../../packages/core/src/index.ts';

/** Offline build tool only. Core code never enters the dependency-free server SDK bundle. */
export function projectServerSchema(input) {
  const registry = validateRegistry(input);
  const events = registry.events.filter(event => event.source === 'server');
  if (!events.length) throw new TypeError('Registered server event definitions are required.');
  return { version: registry.schemaVersion, events: Object.fromEntries(events.map(event => [event.name,
    Object.fromEntries(Object.entries(event.properties).map(([key, rule]) => [key, rule.type === 'boolean' ? ['boolean', rule.required] :
      rule.type === 'enum' ? ['enum', rule.required, [...rule.values]] : ['integer', rule.required, rule.minimum, rule.maximum]]))])) };
}
