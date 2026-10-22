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
import { runCleanup, cleanupPageLimit } from './cleanup.ts';
import { cleanupFailed } from './cleanup-report.ts';
import { logRequestObservation } from './request-observation.ts';
import { checkAdministratorStorageRead } from './readiness.ts';
import { databaseCapacity, requestDatabase } from './dependency-lifetime.ts';

// Host supplies the D1 binding. No deployed resource ID or credential is committed.
export interface CollectorBindings { DB: SqlDatabase; ALLOW_LOCAL_HTTP?: string;
  BROWSER_INGEST_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> } }
export interface WorkerOptions { requestTimeoutMs?: number; maxDatabaseOperations?: number; maxPublicOperations?: number; cleanupMaxPages?: number }
export function createWorker(verifyBearer?: AdministratorAccess['verifyBearer'], verifyPublisher?: PublisherAccess['verifyBearer'],
  options: WorkerOptions = {}) {
  const capacity = databaseCapacity(options.maxDatabaseOperations);
  const publicCapacity = databaseCapacity(options.maxPublicOperations ?? 4);
  const cleanupMaxPages = cleanupPageLimit(options.cleanupMaxPages);
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30_000) throw new TypeError('Invalid request timeout');
  return {
  async fetch(request: Request, bindings: CollectorBindings, context?: { waitUntil(task: Promise<void>): void }): Promise<Response> {
    const lifetime = requestDatabase(bindings.DB, request.signal, capacity, requestTimeoutMs);
    const db = lifetime.db;
    const store = new D1Store(db, { allowLocalHttp: bindings.ALLOW_LOCAL_HTTP === 'true' });
    try {
    return await createCollector(store, { observe: logRequestObservation,
      ...(bindings.BROWSER_INGEST_LIMITER ? { publicAdmission: async (projectId: string) => {
        const result = await publicCapacity(() => bindings.BROWSER_INGEST_LIMITER!.limit({ key: `tallyfin-browser:${projectId}` }));
        if (typeof result.success !== 'boolean') throw new TypeError('Invalid admission response');
        return result.success;
      } } : {}),
      ...(context ? { waitUntil: (task: Promise<void>) => context.waitUntil(task) } : {}),
      ...(verifyBearer ? { admin: { store: new D1Queries(db, { allowLocalHttp: bindings.ALLOW_LOCAL_HTTP === 'true' }), verifyBearer,
        checkReadiness: () => checkAdministratorStorageRead(db) } } : {}),
      ...(verifyPublisher ? { publisher: { store, verifyBearer: verifyPublisher } } : {}) })(new Request(request, { signal: lifetime.signal }));
    } finally { lifetime.close(); }
  },
  // Structural host port, matching Workers' ScheduledController. Await all work.
  async scheduled(controller: { scheduledTime: number }, bindings: CollectorBindings): Promise<void> {
    const runId = crypto.randomUUID();
    const scheduleLagMs = Math.max(0, Date.now() - controller.scheduledTime);
    const lifetime = requestDatabase(bindings.DB, new AbortController().signal, capacity, 30_000);
    try {
      const report = await runCleanup(new D1Maintenance(lifetime.db), controller.scheduledTime,
        { signal: lifetime.signal, maxPages: cleanupMaxPages, onReport: report => {
          console.log(JSON.stringify({ runId, code: 'retention_cleanup', ...report,
            execution: { ...report.execution, scheduleLagMs } }));
        } });
      if (cleanupFailed(report)) throw Error('retention cleanup incomplete');
    } catch (cause) {
      // Do not log DB errors, IDs, content or configuration from rejected work.
      console.warn(JSON.stringify({ runId, code: 'retention_cleanup_failed' }));
      throw Error('Retention cleanup failed.', { cause });
    } finally { lifetime.close(); }
  },
}; }
/** Explicit host opt-in; construction validates config but fetches no keys. */
export function createOidcWorker(options: OidcOptions, publisherOptions?: OidcOptions, workerOptions: WorkerOptions = {}) {
  if (publisherOptions?.audience === options.audience) throw new TypeError('Administrator and publisher audiences must differ.');
  return createWorker(createOidcVerifier(options), publisherOptions ? createOidcVerifier({ ...publisherOptions, exclusiveAudience: true }) : undefined, workerOptions);
}
/** Machine ingestion without administrator access. Host supplies a dedicated API audience. */
export function createPublisherOidcWorker(options: OidcOptions, workerOptions: WorkerOptions = {}) {
  return createWorker(undefined, createOidcVerifier({ ...options, exclusiveAudience: true }), workerOptions);
}
// Authentication is closed until an embedding host explicitly supplies its trusted verifier.
export default createWorker();
