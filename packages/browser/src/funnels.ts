import { createTransport, integer, namePattern, own, uuidPattern } from './common.ts';
import type { BrowserClient, BrowserOptions, BrowserPlatform, BrowserSchema, Properties } from './types.js';
export type { BrowserPlatform, Properties } from './types.js';

/** Non-browser milestones keep their position without exposing server definitions. */
export interface BrowserFunnel { steps: readonly (string | null)[]; dimensions: readonly string[] }
export interface FunnelSchema extends Pick<BrowserSchema, 'version' | 'events'> {
  funnels: Readonly<Record<string, BrowserFunnel>>;
}
export interface FunnelLink { readonly funnelId: string; readonly runId: string; readonly startedAt: string }
export interface FunnelClient extends Omit<BrowserClient, 'start'> {
  /** Create a random task context without queuing an event or storing a visitor identity. */
  createFunnelRun(id: string): FunnelLink | undefined;
  /** Reuse the original logical occurrence time when manually retrying a milestone. */
  trackFunnel(name: string, properties: Properties, link: FunnelLink, occurredAt?: string): boolean;
}
export type FunnelOptions = Omit<BrowserOptions, 'schema'> & { schema: FunnelSchema };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function valid(schema: FunnelSchema): boolean {
  if (Object.keys(schema).length !== 3 || !record(schema.funnels)) return false;
  if (Object.keys(schema.funnels).length < 1 || Object.keys(schema.funnels).length > 10) return false;
  for (const [id, funnel] of Object.entries(schema.funnels)) {
    if (!namePattern.test(id) || !record(funnel) || Object.keys(funnel).length !== 2 ||
      !Array.isArray(funnel.steps) || funnel.steps.length < 2 || funnel.steps.length > 10 ||
      !Array.isArray(funnel.dimensions) || funnel.dimensions.length > 4 ||
      funnel.dimensions.some(key => typeof key !== 'string') ||
      new Set(funnel.dimensions).size !== funnel.dimensions.length) return false;
    const local = funnel.steps.filter(step => step !== null);
    if (!local.length || new Set(local).size !== local.length) return false;
    const first = schema.events[local[0] as string];
    for (const name of local) {
      if (typeof name !== 'string' || !own(schema.events, name)) return false;
      const rules = schema.events[name]!;
      for (const key of funnel.dimensions)
        if (!own(rules, key) || !rules[key]![1] || JSON.stringify(rules[key]) !== JSON.stringify(first![key])) return false;
    }
  }
  return true;
}
function utc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) throw Error();
  const date = new Date(value);
  // Regex bounds fractional precision; compare calendar/time to reject Date.parse normalization.
  if (date.toISOString().slice(0, 19) !== value.slice(0, 19)) throw Error();
  return date.getTime();
}
function copyLink(input: FunnelLink, schema: FunnelSchema): FunnelLink {
  if (!record(input)) throw Error();
  const value = { ...input };
  if (Object.keys(value).length !== 3 || typeof value.funnelId !== 'string' ||
    !own(schema.funnels, value.funnelId) || typeof value.runId !== 'string' || !uuidPattern.test(value.runId)) throw Error();
  return Object.freeze({ ...value, startedAt: new Date(utc(value.startedAt)).toISOString() });
}

/** Optional entry point; ordinary SDK bundles do not include this task profile. */
export function createTallyfinFunnels(options: FunnelOptions, host?: BrowserPlatform): FunnelClient {
  const transport = createTransport(options, host, valid);
  if (!transport) return { track: () => false, createFunnelRun: () => undefined, trackFunnel: () => false,
    flush() {}, destroy() {}, pending: 0 };
  const { schema, platform, enqueue } = transport;
  const funnels = Object.values(schema.funnels);
  let stopped = false;
  return {
    get pending() { return transport.pending; },
    track(name, properties = {}) {
      try { return !funnels.some(funnel => funnel.steps.includes(name)) && enqueue(name, properties, platform.now()); } catch { return false; }
    },
    createFunnelRun(id) {
      try {
        if (stopped || !own(schema.funnels, id) || !schema.funnels[id]!.steps[0]) return undefined;
        const now = platform.now(); if (!integer(now, 0, 8640000000000000)) return undefined;
        return copyLink({ funnelId: id, runId: platform.uuid(), startedAt: new Date(now).toISOString() }, schema);
      } catch { return undefined; }
    },
    trackFunnel(name, properties, input, occurredAt) {
      try {
        const link = copyLink(input, schema), index = schema.funnels[link.funnelId]!.steps.indexOf(name), start = Date.parse(link.startedAt);
        const now = platform.now(), time = occurredAt === undefined ? (index === 0 ? start : now) : utc(occurredAt);
        if (index < 0 || !integer(now, 0, 8640000000000000) || time < now - 86400000 || time > now + 300000 ||
          time < start || time - start > 86400000 || index === 0 && time !== start) return false;
        return enqueue(name, properties, time, { funnel: link });
      } catch { return false; }
    },
    flush: transport.flush,
    destroy() { stopped = true; transport.destroy(); },
  };
}
