import { CollectionError, parseBatch, prepareBatch, PROJECT_ID, REJECTION_REASONS } from '@tallyfin/core';
import type { CollectionStore, ErrorCode, RejectionReason } from '@tallyfin/core';
import { readBody } from './body.ts';
import { administrator } from './admin.ts';
import type { AdministratorAccess } from './admin.ts';

const messages: Record<ErrorCode, string> = {
  invalid_request: 'Invalid request.', invalid_event: 'Invalid or unregistered event.', unknown_schema: 'Schema is unavailable.',
  origin_denied: 'Origin is not allowed.', project_unavailable: 'Project is unavailable.',
  event_conflict: 'Event ID conflicts with a previous event.', attempt_conflict: 'Attempt conflicts with previous state.',
  settings_conflict: 'Project settings changed. Reload before saving.',
  schema_conflict: 'Schema version conflicts. Reload and review before publishing.',
  project_conflict: 'Project ID conflicts with an existing project.',
  project_limit_reached: 'Project creation limit reached.',
  quota_exceeded: 'Collection quota exceeded.', unauthorized: 'Administrator authentication is required.',
  forbidden: 'Access denied.', not_found: 'Endpoint not found.', storage_unavailable: 'Storage is temporarily unavailable.',
};
export interface CollectorOptions {
  now?: () => number;
  log?: (entry: { requestId: string; code: ErrorCode }) => void;
  admin?: AdministratorAccess;
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
    const requestId = crypto.randomUUID();
    const receivedAt = (options.now ?? Date.now)();
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    let retryAfter: number | undefined;
    let rejectionProjectId: string | null = null;
    let admitted = false;
    try {
      const path = new URL(request.url).pathname;
      const route = /^\/v1\/projects\/([^/]+)\/batches$/.exec(path);
      if (!route) {
        if (path === '/v1/projects' || path.startsWith('/v1/projects/')) {
          const result = await administrator(request, options.admin, receivedAt);
          return Response.json(result, { headers });
        }
        throw new CollectionError('not_found', 404);
      }
      const projectId = route[1]!;
      if (!PROJECT_ID.test(projectId)) throw new CollectionError('invalid_request', 400);
      const project = await store.loadProject(projectId);
      if (!project) throw new CollectionError('not_found', 404);
      rejectionProjectId = projectId;
      const origin = request.headers.get('Origin');
      const permitted = allowedOrigin(origin, project.allowedOrigins);
      if (permitted) headers.set('Access-Control-Allow-Origin', origin);
      // Denials, malformed requests and preflights consume admission, including repeated IDs.
      if (!await store.admit(projectId, receivedAt, project.limits.requestsPerMinute)) {
        retryAfter = Math.max(1, Math.ceil((60_000 - receivedAt % 60_000) / 1000));
        throw new CollectionError('quota_exceeded', 429);
      }
      admitted = true;
      if (!permitted) throw new CollectionError('origin_denied', 403);
      if (project.status !== 'active') throw new CollectionError('project_unavailable', 403);
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        const requestedHeaders = request.headers.get('Access-Control-Request-Headers') ?? '';
        if (requestedHeaders.length > 128) throw new CollectionError('invalid_request', 400);
        const requested = requestedHeaders.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
        if (method !== 'POST' || requested.some(name => name !== 'content-type')) throw new CollectionError('invalid_request', 400);
        headers.set('Access-Control-Allow-Methods', 'POST'); headers.set('Access-Control-Allow-Headers', 'Content-Type');
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'POST') { headers.set('Allow', 'POST, OPTIONS'); throw new CollectionError('invalid_request', 405); }
      const batch = parseBatch(await readBody(request));
      const registry = await store.loadRegistry(projectId, batch.schemaVersion);
      if (!registry) throw new CollectionError('unknown_schema', 422);
      // Recheck the configuration loaded for this version before hashing or writing.
      if (!allowedOrigin(origin, registry.allowedOrigins)) { headers.delete('Access-Control-Allow-Origin'); throw new CollectionError('origin_denied', 403); }
      const prepared = await prepareBatch(batch, registry, receivedAt);
      const result = await store.commit(prepared, registry);
      if (result.accepted + result.duplicates !== batch.events.length) throw new CollectionError('storage_unavailable', 503);
      return Response.json(result, { status: 200, headers });
    } catch (error) {
      const failure = error instanceof CollectionError ? error : new CollectionError('storage_unavailable', 503);
      if (failure.status === 401) headers.set('WWW-Authenticate', 'Bearer');
      if (failure.status === 405 && !routeForCollection(request.url)) headers.set('Allow',
        new URL(request.url).pathname === '/v1/projects' ? 'GET, POST' :
        /^\/v1\/projects\/[^/]+\/schemas\/validate$/.test(new URL(request.url).pathname) ? 'POST' :
        /^\/v1\/projects\/[^/]+\/schemas\/[^/]+$/.test(new URL(request.url).pathname) ? 'GET, PUT' :
        /^\/v1\/projects\/[^/]+$/.test(new URL(request.url).pathname) ? 'GET, PATCH' : 'GET');
      if (failure.status === 429) {
        // Admission resumes at the next fixed minute; daily quota resumes at UTC midnight.
        headers.set('Retry-After', String(retryAfter ?? Math.max(1, Math.ceil((86_400_000 - receivedAt % 86_400_000) / 1000))));
      } else if (failure.status === 503) headers.set('Retry-After', '1');
      // A diagnostic sink failure must not change the outcome or disclose its exception.
      try { options.log?.({ requestId, code: failure.code }); } catch { /* best effort */ }
      if (admitted && rejectionProjectId) {
        const reason = failure.code === 'quota_exceeded' ? 'daily_limit' : failure.code as RejectionReason;
        if (reason !== 'minute_limit' && REJECTION_REASONS.includes(reason)) {
          const id = rejectionProjectId;
          const task = (async () => {
            try { await store.recordRejection(id, receivedAt, reason); } catch { /* bounded best-effort, no retry or raw error logging */ }
          })();
          if (options.waitUntil) {
            try { options.waitUntil(task); } catch { await task; }
          } else await task;
        }
      }
      return Response.json({ error: { code: failure.code, message: messages[failure.code], requestId } }, { status: failure.status, headers });
    }
  };
}
const routeForCollection = (url: string) => /^\/v1\/projects\/[^/]+\/batches$/.test(new URL(url).pathname);
