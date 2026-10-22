import { CollectionError, validateOverviewInput } from '@tallyfin/core';
import { parameters } from './admin-input.ts';
import { awaitDependency } from './dependency-lifetime.ts';
import { OidcDependencyError } from '@tallyfin/auth-oidc';
import type { AdminPrincipal, AdminStore } from '@tallyfin/core';
import { healthRoute, identityRoute, changesRoute, rejectionsRoute, schemasRoute, listRoute, queryRoute } from './admin-read.ts';
import { publishersRoute, grantsRoute, createRoute, draftRoute, publishRoute, settingsRoute } from './admin-write.ts';

/** The host must verify signature, issuer, audience and expiry before returning a principal. */
export interface AdministratorAccess {
  store: AdminStore;
  verifyBearer: (bearer: string, options?: { signal?: AbortSignal; throwDependencyErrors?: boolean }) => Promise<AdminPrincipal | null>;
  /** Optional host port for a bounded, read-only administrator storage probe. */
  checkReadiness?: () => Promise<void>;
}
export async function administrator(request: Request, access: AdministratorAccess | undefined, now: number): Promise<unknown> {
  const principal = await authenticate(request, access);
  const url = new URL(request.url);
  const context = { request, url, access: access!, principal, now };
  if (url.pathname === '/v1/health') return healthRoute(context);
  if (url.pathname === '/v1/identity') return identityRoute(context);
  if (url.pathname === '/v1/overview') {
    if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
    parameters(url, ['projectIds', 'source']);
    const ids = (url.searchParams.get('projectIds') ?? '').split(','), source = url.searchParams.get('source') ?? 'browser';
    validateOverviewInput(ids, source);
    if (!access!.store.overview) throw new CollectionError('storage_unavailable', 503);
    return access!.store.overview(principal, ids, source, now, { signal: request.signal });
  }
  const changes = /^\/v1\/projects\/([^/]+)\/changes$/.exec(url.pathname);
  if (changes) return changesRoute(context, changes[1]!);
  const publishers = /^\/v1\/projects\/([^/]+)\/publishers$/.exec(url.pathname);
  if (publishers) return publishersRoute(context, publishers[1]!);
  const grants = /^\/v1\/projects\/([^/]+)\/grants$/.exec(url.pathname);
  if (grants) return grantsRoute(context, grants[1]!);
  const rejections = /^\/v1\/projects\/([^/]+)\/collection\/rejections$/.exec(url.pathname);
  if (rejections) return rejectionsRoute(context, rejections[1]!);
  if (url.pathname === '/v1/projects' && request.method === 'POST') return createRoute(context);
  const settings = /^\/v1\/projects\/([^/]+)$/.exec(url.pathname);
  const schemas = /^\/v1\/projects\/([^/]+)\/schemas$/.exec(url.pathname);
  if (schemas) return schemasRoute(context, schemas[1]!);
  const draft = /^\/v1\/projects\/([^/]+)\/schemas\/validate$/.exec(url.pathname);
  if (draft) return draftRoute(context, draft[1]!);
  const publication = /^\/v1\/projects\/([^/]+)\/schemas\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'PUT' && publication) return publishRoute(context, publication[1]!, publication[2]!);
  if (request.method !== 'GET' && !(request.method === 'PATCH' && settings)) throw new CollectionError('invalid_request', 405);
  if (settings) return settingsRoute(context, settings[1]!);
  if (url.pathname === '/v1/projects') return listRoute(context);
  return queryRoute(context);
}
async function authenticate(request: Request, access: AdministratorAccess | undefined): Promise<AdminPrincipal> {
  const header = request.headers.get('Authorization');
  if (!access || !header || header.length > 8192 || !/^Bearer [^\s,]+$/i.test(header)) throw new CollectionError('unauthorized', 401);
  let principal: AdminPrincipal | null;
  try { principal = await awaitDependency(request.signal, () => access.verifyBearer(header.slice(7), { signal: request.signal, throwDependencyErrors: true })); }
  catch (cause) {
    request.signal.throwIfAborted();
    throw cause instanceof OidcDependencyError ? new CollectionError('storage_unavailable', 503, { cause })
      : new CollectionError('unauthorized', 401, { cause });
  }
  if (!principal || typeof principal.issuer !== 'string' || typeof principal.subject !== 'string' ||
    !principal.issuer.trim() || !principal.subject.trim() || principal.issuer.length > 512 || principal.subject.length > 512)
    throw new CollectionError('unauthorized', 401);
  return principal;
}
