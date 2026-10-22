import { CollectionError, validGrantIdentity } from '@tallyfin/core';
import { awaitDependency } from './dependency-lifetime.ts';
import type { ServerCollectionStore, ServerPrincipal } from '@tallyfin/core';

/** Dedicated trusted machine verifier; never fall back to administrator authentication or token claims. */
export interface PublisherAccess {
  store: ServerCollectionStore;
  verifyBearer: (bearer: string, options?: { signal?: AbortSignal }) => Promise<ServerPrincipal | null>;
}
export async function authenticatePublisher(request: Request, access: PublisherAccess | undefined): Promise<ServerPrincipal> {
  const header = request.headers.get('Authorization');
  if (!access || !header || header.length > 8192 || !/^Bearer [^\s,]+$/i.test(header)) throw new CollectionError('unauthorized', 401);
  let principal: ServerPrincipal | null;
  try { principal = await awaitDependency(request.signal, () => access.verifyBearer(header.slice(7), { signal: request.signal })); }
  catch (cause) { request.signal.throwIfAborted(); throw new CollectionError('unauthorized', 401, { cause }); }
  if (!principal || !validGrantIdentity(principal.issuer, principal.subject)) throw new CollectionError('unauthorized', 401);
  return { issuer: principal.issuer, subject: principal.subject };
}
