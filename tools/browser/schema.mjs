import { validateRegistry } from '../../packages/core/src/index.ts';

/** Build-time only. The SDK never imports the full registry validator or server definitions. */
export function projectBrowserSchema(input) {
  const registry = validateRegistry(input);
  if (registry.project.status !== 'active' || registry.schemaStatus !== 'active') throw Error('inactive browser schema');
  if (!registry.events.some(event => event.source === 'browser')) throw Error('Registered browser event definitions are required.');
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

/** Optional funnel profile; server stages remain null positions, never runtime definitions. */
export function projectFunnelBrowserSchema(input) {
  const registry = validateRegistry(input), browser = projectBrowserSchema(input);
  const funnels = (registry.funnels ?? []).filter(funnel => funnel.steps.some(step => step.source === 'browser'));
  if (!funnels.length) throw Error('Registered browser funnel definitions are required.');
  const stages = new Set(funnels.flatMap(funnel => funnel.steps.filter(step => step.source === 'browser').map(step => step.eventName)));
  const legacy = new Set(registry.workflows.flatMap(workflow => [workflow.startEvent, workflow.successEvent, workflow.failureEvent]));
  return { version: browser.version,
    events: Object.fromEntries(Object.entries(browser.events).filter(([name]) => !legacy.has(name) || stages.has(name))),
    funnels: Object.fromEntries(funnels.map(funnel => [funnel.id, {
      steps: funnel.steps.map(step => step.source === 'browser' ? step.eventName : null), dimensions: [...funnel.dimensions],
    }])),
  };
}
