import { awaitDependency } from './dependency-lifetime.ts';
import { failureHeaders, messages, recordRejectedRequest } from './failure.ts';
import { CollectionError, parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, PROJECT_ID } from '@tallyfin/core';
import type { CollectionStore, ErrorCode } from '@tallyfin/core';
import { readBody } from './body.ts';
import { administrator } from './admin.ts';
import type { AdministratorAccess } from './admin.ts';
import { authenticatePublisher } from './publisher.ts';
import type { PublisherAccess } from './publisher.ts';
import { observationClock, latencyBucket } from './request-observation.ts';
import type { RequestObservation, RequestOperation } from './request-observation.ts';

export interface CollectorOptions {
  now?: () => number;
  uuid?: () => string;
  log?: (entry: { requestId: string; code: ErrorCode }) => void;
  observe?: (entry: RequestObservation) => void;
  monotonicNow?: () => number;
  admin?: AdministratorAccess;
  publisher?: PublisherAccess;
  publicAdmission?: (projectId: string, signal: AbortSignal) => Promise<boolean>;
  waitUntil?: (task: Promise<void>) => void;
}
export function allowedOrigin(origin: string | null, allowed: string[]): origin is string {
  if (!origin || origin.length > 256 || !Array.isArray(allowed) || !allowed.includes(origin)) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && !origin.includes('*') && !url.username && !url.password && ['https:', 'http:'].includes(url.protocol);
  } catch { return false; }
}

export function createCollector(store: CollectionStore, options: CollectorOptions = {}) {
  return async (request: Request): Promise<Response> => {
    const requestId = (options.uuid ?? (() => crypto.randomUUID()))();
    const clock = options.monotonicNow ?? (() => performance.now());
    const started = options.observe ? observationClock(clock) : null;
    let operation: RequestOperation = 'other';
    const finish = (response: Response, code: ErrorCode | 'ok' = 'ok') => {
      if (options.observe) {
        try { options.observe({ requestId, operation, status: response.status, code,
          latencyBucket: latencyBucket(started, observationClock(clock)) }); } catch { /* best effort, no raw sink errors */ }
      }
      return response;
    };
    const receivedAt = (options.now ?? Date.now)();
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    let retryAfter: number | undefined;
    let rejectionProjectId: string | null = null;
    let admitted = false;
    let activeStore = store;
    try {
      const path = new URL(request.url).pathname;
      const route = /^\/v1\/projects\/([^/]+)\/(batches|server-batches)$/.exec(path);
      if (!route) {
        if (path === '/v1/health' || path === '/v1/identity' || path === '/v1/projects' || path.startsWith('/v1/projects/')) {
          operation = 'administrator';
          if (path === '/v1/health' || path === '/v1/identity') headers.set('Vary', 'Authorization');
          const result = await administrator(request, options.admin, receivedAt);
          return finish(Response.json(result, { headers }));
        }
        throw new CollectionError('not_found', 404);
      }
      const isServer = route[2] === 'server-batches';
      operation = isServer ? 'server_collection' : 'browser_collection';
      if (isServer) headers.set('Vary', 'Authorization');
      // Authenticate before reading any project, granting CORS, admission or consuming the body.
      const principal = isServer ? await authenticatePublisher(request, options.publisher) : null;
      if (isServer) activeStore = options.publisher!.store;
      const projectId = route[1]!;
      if (!PROJECT_ID.test(projectId)) throw new CollectionError('invalid_request', 400);
      if (!isServer && options.publicAdmission && !await awaitDependency(request.signal, () => options.publicAdmission!(projectId, request.signal))) {
        retryAfter = 60;
        throw new CollectionError('quota_exceeded', 429);
      }
      if (principal) await options.publisher!.store.publisherAccess(projectId, principal);
      const project = await activeStore.loadProject(projectId);
      if (!project) throw new CollectionError(isServer ? 'forbidden' : 'not_found', isServer ? 403 : 404);
      rejectionProjectId = projectId;
      const origin = request.headers.get('Origin');
      const permitted = isServer || allowedOrigin(origin, project.allowedOrigins);
      if (!isServer && permitted && origin) headers.set('Access-Control-Allow-Origin', origin);
      // Untrusted origins cannot consume the quota used by permitted origins.
      if (!permitted) throw new CollectionError('origin_denied', 403);
      // Permitted-origin malformed requests and preflights still consume admission.
      if (!await activeStore.admit(projectId, receivedAt, project.limits.requestsPerMinute)) {
        retryAfter = Math.max(1, Math.ceil((60_000 - receivedAt % 60_000) / 1000));
        throw new CollectionError('quota_exceeded', 429);
      }
      admitted = true;
      if (project.status !== 'active') throw new CollectionError('project_unavailable', 403);
      if (!isServer && request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        const requestedHeaders = request.headers.get('Access-Control-Request-Headers') ?? '';
        if (requestedHeaders.length > 128) throw new CollectionError('invalid_request', 400);
        const requested = requestedHeaders.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
        if (method !== 'POST' || requested.some(name => name !== 'content-type')) throw new CollectionError('invalid_request', 400);
        headers.set('Access-Control-Allow-Methods', 'POST'); headers.set('Access-Control-Allow-Headers', 'Content-Type');
        return finish(new Response(null, { status: 204, headers }));
      }
      if (request.method !== 'POST') { headers.set('Allow', isServer ? 'POST' : 'POST, OPTIONS'); throw new CollectionError('invalid_request', 405); }
      if (isServer && new URL(request.url).search) throw new CollectionError('invalid_request', 400);
      if (isServer && (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase() !== 'application/json')
        throw new CollectionError('invalid_request', 415);
      const body = await readBody(request);
      const batch = isServer ? parseServerBatch(body) : parseBatch(body);
      const registry = await activeStore.loadRegistry(projectId, batch.schemaVersion);
      if (!registry) throw new CollectionError('unknown_schema', 422);
      // Recheck the configuration loaded for this version before hashing or writing.
      if (!isServer && !allowedOrigin(origin, registry.allowedOrigins)) { headers.delete('Access-Control-Allow-Origin'); throw new CollectionError('origin_denied', 403); }
      const result = batch.source === 'server'
        ? await options.publisher!.store.commitServer(await prepareServerBatch(batch, registry, receivedAt), registry, principal!)
        : await activeStore.commit(await prepareBatch(batch, registry, receivedAt), registry);
      if (result.accepted + result.duplicates !== batch.events.length) throw new CollectionError('storage_unavailable', 503);
      return finish(Response.json(result, { status: 200, headers }));
    } catch (error) {
      const failure = error instanceof CollectionError ? error : new CollectionError('storage_unavailable', 503, { cause: error });
      const responseHeaders = failureHeaders(failure, request.url, receivedAt, retryAfter, headers);
      // A diagnostic sink failure must not change the outcome or disclose its exception.
      try { options.log?.({ requestId, code: failure.code }); } catch { /* best effort */ }
      if (admitted && rejectionProjectId)
        await recordRejectedRequest(activeStore, rejectionProjectId, receivedAt, failure.code, options.waitUntil);
      return finish(Response.json({ error: { code: failure.code, message: messages[failure.code], requestId } }, { status: failure.status, headers: responseHeaders }), failure.code);
    }
  };
}
