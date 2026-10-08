import { createTallyfin } from '../../packages/browser/src/index.ts';
import type { BrowserSchema } from '../../packages/browser/src/index.ts';
import schema from '../../examples/sembom/browser-schema.json' with { type: 'json' };

// Local benchmark only. Production SDK defaults and the Sembom adapter are unchanged.
export function connect() {
  return createTallyfin({ endpoint: `${location.origin}/v1/projects/sembom/batches`,
    schema: schema as unknown as BrowserSchema, allowLocalHttp: true, enabled: true });
}
