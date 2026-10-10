import { createTallyfinFunnels } from '../../packages/browser/src/funnels.ts';
import type { BrowserPlatform, FunnelSchema } from '../../packages/browser/src/funnels.ts';
import schema from './browser-schema.json' with { type: 'json' };

/** Register this example's reviewed definitions; carry only run metadata in the business request. */
export function createTaskAnalytics(endpoint: string, enabled = true, host?: BrowserPlatform) {
  return createTallyfinFunnels({ endpoint, schema: schema as unknown as FunnelSchema, enabled }, host);
}
