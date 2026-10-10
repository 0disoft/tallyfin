import { createTallyfinServer } from '../../packages/server/src/index.ts';
import type { ServerOptions, ServerPlatform, ServerSchema } from '../../packages/server/src/index.ts';

/** Kept equal to the reviewed server projection of api/examples/job-registry.json by integration checks. */
export const jobSchema = { version: 1, events: { job_finished: {
  outcome: ['enum', true, ['success', 'failure']], retried: ['boolean', false],
} } } satisfies ServerSchema;

/** Source import is for this checkout; installed services import @tallyfin/server. No issuer or token is selected here. */
export function createJobAnalytics(endpoint: string, getToken: ServerOptions['getToken'], host?: ServerPlatform) {
  return createTallyfinServer({ endpoint, schema: jobSchema, getToken }, host);
}
