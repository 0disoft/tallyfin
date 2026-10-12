import { createTransport, namePattern, own, uuidPattern } from './common.ts';
import type { BrowserClient, BrowserOptions, BrowserPlatform, BrowserSchema, Properties } from './types.js';
export type { Value, Properties, Rule, BrowserSchema, BrowserOptions, AttemptHandle, BrowserClient, BrowserPlatform } from './types.js';
const empty = (): BrowserClient => ({ track: () => false, start: () => undefined, flush() {}, destroy() {}, pending: 0 });

function workflowsValid(schema: BrowserSchema): boolean {
  if (Object.keys(schema.workflows).length > 10) return false;
  const bound = new Set<string>();
  for (const [id, workflow] of Object.entries(schema.workflows)) {
    if (!namePattern.test(id) || !Array.isArray(workflow.dimensions) || workflow.dimensions.length > 4 || new Set(workflow.dimensions).size !== workflow.dimensions.length) return false;
    const phases = [workflow.start, workflow.success, ...(workflow.failure === undefined ? [] : [workflow.failure])];
    for (const name of phases) {
      if (!own(schema.events, name) || bound.has(name)) return false;
      bound.add(name);
      for (const key of workflow.dimensions) {
        const rule = schema.events[name]![key];
        if (!own(schema.events[name]!, key) || !rule?.[1] || JSON.stringify(rule) !== JSON.stringify(schema.events[workflow.start]![key])) return false;
      }
    }
  }
  return true;
}
export function createTallyfin(options: BrowserOptions, host?: BrowserPlatform): BrowserClient {
  const transport = createTransport(options, host, workflowsValid);
  if (!transport) return empty();
  const { schema, platform, enqueue, snapshot } = transport;
  const phases = new Set(Object.values(schema.workflows).flatMap(w => [w.start, w.success, w.failure]));
  return {
    get pending() { return transport.pending; },
    track(name, properties = {}) {
      try { return !phases.has(name) && enqueue(name, properties, platform.now()); } catch { return false; }
    },
    start(workflowId, properties = {}) {
      try {
        if (typeof workflowId !== 'string' || !own(schema.workflows, workflowId)) return undefined;
        const workflow = schema.workflows[workflowId]!;
        const copied = snapshot(workflow.start, properties); if (!copied) return undefined;
        const started = platform.now(); const attemptId = platform.uuid();
        if (typeof attemptId !== 'string' || !uuidPattern.test(attemptId)) return undefined;
        const attempt = { workflowId, attemptId, startedAt: new Date(started).toISOString() };
        if (!enqueue(workflow.start, copied, started, { attempt })) return undefined;
        const dimensions = Object.fromEntries(workflow.dimensions.map(key => [key, copied[key]!])) as Properties;
        let ended = false;
        const end = (name: string | undefined, values: Properties = {}) => {
          try {
            const now = platform.now();
            const copied = Object.fromEntries(Object.entries(values));
            if (ended || !name || now < started || now - started > 86400000 ||
              workflow.dimensions.some(key => own(copied, key) && copied[key] !== dimensions[key])) return false;
            if (!enqueue(name, { ...dimensions, ...copied }, now, { attempt })) return false;
            ended = true; return true;
          } catch { return false; }
        };
        return { succeed: values => end(workflow.success, values), fail: values => end(workflow.failure, values), cancel() { ended = true; } };
      } catch { return undefined; }
    },
    flush: transport.flush, destroy: transport.destroy,
  };
}
