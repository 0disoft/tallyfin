import { D1Maintenance, D1Queries, D1Store } from '@tallyfin/storage-d1';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { createCollector } from './handler.ts';
import { createOidcVerifier } from '@tallyfin/auth-oidc';
import type { OidcOptions } from '@tallyfin/auth-oidc';
export { createCollector } from './handler.ts';
export type { AdministratorAccess } from './admin.ts';
export type { PublisherAccess } from './publisher.ts';
import type { AdministratorAccess } from './admin.ts';
import type { PublisherAccess } from './publisher.ts';
import { runCleanup } from './cleanup.ts';
import { logRequestObservation } from './request-observation.ts';

// Host supplies the D1 binding. No deployed resource ID or credential is committed.
export interface CollectorBindings { DB: SqlDatabase; ALLOW_LOCAL_HTTP?: string }
export function createWorker(verifyBearer?: AdministratorAccess['verifyBearer'], verifyPublisher?: PublisherAccess['verifyBearer']) { return {
  async fetch(request: Request, bindings: CollectorBindings, context?: { waitUntil(task: Promise<void>): void }): Promise<Response> {
    const store = new D1Store(bindings.DB, { allowLocalHttp: bindings.ALLOW_LOCAL_HTTP === 'true' });
    return createCollector(store, { observe: logRequestObservation,
      ...(context ? { waitUntil: (task: Promise<void>) => context.waitUntil(task) } : {}),
      ...(verifyBearer ? { admin: { store: new D1Queries(bindings.DB, { allowLocalHttp: bindings.ALLOW_LOCAL_HTTP === 'true' }), verifyBearer } } : {}),
      ...(verifyPublisher ? { publisher: { store, verifyBearer: verifyPublisher } } : {}) })(request);
  },
  // Structural host port, matching Workers' ScheduledController. Await all work.
  async scheduled(controller: { scheduledTime: number }, bindings: CollectorBindings): Promise<void> {
    const runId = crypto.randomUUID();
    try {
      const report = await runCleanup(new D1Maintenance(bindings.DB), controller.scheduledTime);
      console.log(JSON.stringify({ runId, code: 'retention_cleanup', ...report }));
      if (report.failed || !report.cursorAdvanced) throw Error('retention cleanup incomplete');
    } catch {
      // Do not log DB errors, IDs, content or configuration from rejected work.
      console.warn(JSON.stringify({ runId, code: 'retention_cleanup_failed' }));
      throw Error('Retention cleanup failed.');
    }
  },
}; }
/** Explicit host opt-in; construction validates config but fetches no keys. */
export function createOidcWorker(options: OidcOptions, publisherOptions?: OidcOptions) {
  if (publisherOptions?.audience === options.audience) throw new TypeError('Administrator and publisher audiences must differ.');
  return createWorker(createOidcVerifier(options), publisherOptions ? createOidcVerifier({ ...publisherOptions, exclusiveAudience: true }) : undefined);
}
/** Machine ingestion without administrator access. Host supplies a dedicated API audience. */
export function createPublisherOidcWorker(options: OidcOptions) {
  return createWorker(undefined, createOidcVerifier({ ...options, exclusiveAudience: true }));
}
// Authentication is closed until an embedding host explicitly supplies its trusted verifier.
export default createWorker();
