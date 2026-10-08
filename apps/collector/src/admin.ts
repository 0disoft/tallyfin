import { CollectionError, dateMillis, DAY, NAME, PROJECT_ID } from '@tallyfin/core';
import type { AdminPrincipal, AdminQuery, AdminStore } from '@tallyfin/core';

/** The host must verify signature, issuer, audience and expiry before returning a principal. */
export interface AdministratorAccess {
  store: AdminStore;
  verifyBearer: (bearer: string) => Promise<AdminPrincipal | null>;
}
export async function administrator(request: Request, access: AdministratorAccess | undefined, now: number): Promise<unknown> {
  const header = request.headers.get('Authorization');
  if (!access || !header || header.length > 8192 || !/^Bearer [^\s,]+$/i.test(header)) throw new CollectionError('unauthorized', 401);
  let principal: AdminPrincipal | null;
  try { principal = await access.verifyBearer(header.slice(7)); } catch { throw new CollectionError('unauthorized', 401); }
  if (!principal || typeof principal.issuer !== 'string' || typeof principal.subject !== 'string' ||
    !principal.issuer.trim() || !principal.subject.trim() || principal.issuer.length > 512 || principal.subject.length > 512)
    throw new CollectionError('unauthorized', 401);
  if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
  const url = new URL(request.url);
  if (url.pathname === '/v1/projects') {
    parameters(url, ['limit', 'cursor']);
    const limit = positive(url.searchParams.get('limit') ?? '25', 100);
    const cursor = url.searchParams.get('cursor') ?? '';
    if (cursor && !PROJECT_ID.test(cursor)) throw new CollectionError('invalid_request', 400);
    return access.store.list(principal, limit, cursor);
  }
  const match = /^\/v1\/projects\/([^/]+)\/(?:schemas\/([^/]+)|(summary)|events\/([^/]+)\/daily|workflows\/([^/]+)\/daily)$/.exec(url.pathname);
  if (!match) throw new CollectionError('not_found', 404);
  if (!PROJECT_ID.test(match[1]!)) throw new CollectionError('invalid_request', 400);
  const kind = match[2] ? 'registry' : match[3] ? 'summary' : match[4] ? 'event' : 'workflow';
  parameters(url, kind === 'registry' ? [] : kind === 'event' ? ['schemaVersion', 'from', 'to', 'groupBy'] : ['schemaVersion', 'from', 'to']);
  const query: AdminQuery = { projectId: match[1]!, version: positive(match[2] ?? url.searchParams.get('schemaVersion') ?? '', 2147483647), kind };
  if (kind !== 'registry') {
    query.from = url.searchParams.get('from') ?? ''; query.to = url.searchParams.get('to') ?? '';
    const start = dateMillis(query.from), end = dateMillis(query.to);
    if (start > end || end - start >= 31 * DAY) throw new CollectionError('invalid_request', 400);
    const name = match[4] ?? match[5];
    if (name !== undefined) { if (!NAME.test(name)) throw new CollectionError('invalid_request', 400); query.name = name; }
    const groupBy = url.searchParams.get('groupBy');
    if (groupBy !== null) { if (!NAME.test(groupBy)) throw new CollectionError('invalid_request', 400); query.groupBy = groupBy; }
  }
  return access.store.query(principal, query, now);
}
function parameters(url: URL, allowed: string[]) {
  if (url.search.length > 512) throw new CollectionError('invalid_request', 400);
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new CollectionError('invalid_request', 400);
    seen.add(key);
  }
}
function positive(value: string, maximum: number): number {
  const number = Number(value);
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(number) || number > maximum) throw new CollectionError('invalid_request', 400);
  return number;
}
