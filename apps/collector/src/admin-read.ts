import { projectSearch, QUERY_POLICY, SCHEMA_LIMITS } from '@tallyfin/core';
import { CollectionError, dateMillis, DAY, NAME, PROJECT_ID, validGrantIdentity } from '@tallyfin/core';
import type { AdminQuery } from '@tallyfin/core';
import { parameters, positive } from './admin-input.ts';
import type { AdminContext } from './admin-input.ts';

export async function healthRoute({ request, url, access, principal }: AdminContext): Promise<unknown> {
  if (!validGrantIdentity(principal.issuer, principal.subject)) throw new CollectionError('unauthorized', 401);
  if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
  parameters(url, []);
  if (!access.checkReadiness) throw new CollectionError('storage_unavailable', 503);
  try { await access.checkReadiness(); } catch { throw new CollectionError('storage_unavailable', 503); }
  return { status: 'ok', scope: 'administrator_storage_read' };
}

export async function identityRoute({ request, url, access, principal }: AdminContext): Promise<unknown> {
  if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
  parameters(url, []);
  if (!validGrantIdentity(principal.issuer, principal.subject)) throw new CollectionError('unauthorized', 401);
  // Only the caller's verified access-token principal; no DB read or authority assignment.
  return { issuer: principal.issuer, subject: principal.subject };
}

export async function changesRoute({ request, url, access, principal, now }: AdminContext, id: string): Promise<unknown> {
  if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  parameters(url, ['limit', 'cursor']);
  return access.store.changes(principal, id, positive(url.searchParams.get('limit') ?? String(QUERY_POLICY.defaultPageSize), QUERY_POLICY.maxPageSize),
    url.searchParams.get('cursor') ?? '', now);
}

export async function rejectionsRoute({ request, url, access, principal, now }: AdminContext, id: string): Promise<unknown> {
  if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  parameters(url, ['from', 'to']);
  return access.store.rejections(principal, id, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '', now);
}

export async function schemasRoute({ request, url, access, principal }: AdminContext, id: string): Promise<unknown> {
  if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  parameters(url, ['limit', 'beforeVersion']);
  return access.store.schemas(principal, id, positive(url.searchParams.get('limit') ?? String(QUERY_POLICY.defaultPageSize), QUERY_POLICY.maxPageSize),
    url.searchParams.has('beforeVersion') ? positive(url.searchParams.get('beforeVersion')!, SCHEMA_LIMITS.maxVersion) : null);
}

export async function listRoute({ url, access, principal }: AdminContext): Promise<unknown> {
  parameters(url, ['limit', 'cursor', 'q'], QUERY_POLICY.maxProjectSearchQueryChars);
  const limit = positive(url.searchParams.get('limit') ?? String(QUERY_POLICY.defaultPageSize), QUERY_POLICY.maxPageSize);
  const cursor = url.searchParams.get('cursor') ?? '';
  if (cursor && !PROJECT_ID.test(cursor)) throw new CollectionError('invalid_request', 400);
  return access.store.list(principal, limit, cursor, projectSearch(url.searchParams.get('q') ?? ''));
}

export async function queryRoute({ url, access, principal, now }: AdminContext): Promise<unknown> {
  const match = /^\/v1\/projects\/([^/]+)\/(?:schemas\/([^/]+)|(summary)|events\/([^/]+)\/daily|workflows\/([^/]+)\/(daily|breakdown)|funnels\/([^/]+)\/(daily|breakdown))$/.exec(url.pathname);
  if (!match) throw new CollectionError('not_found', 404);
  if (!PROJECT_ID.test(match[1]!)) throw new CollectionError('invalid_request', 400);
  const kind = match[2] ? 'registry' : match[3] ? 'summary' : match[4] ? 'event' : match[7] ? (match[8] === 'breakdown' ? 'funnel-breakdown' : 'funnel') : match[6] === 'breakdown' ? 'workflow-breakdown' : 'workflow';
  const allowed = kind === 'registry' ? [] : kind === 'event' || kind === 'workflow-breakdown' || kind === 'funnel-breakdown' ? ['schemaVersion', 'from', 'to', 'groupBy'] : ['schemaVersion', 'from', 'to'];
  if (kind === 'summary' || kind === 'event') allowed.push('source');
  parameters(url, allowed);
  const query: AdminQuery = { projectId: match[1]!, version: positive(match[2] ?? url.searchParams.get('schemaVersion') ?? '', SCHEMA_LIMITS.maxVersion), kind };
  if (kind !== 'registry') {
    const source = url.searchParams.get('source');
    if (source !== null) {
      if (source !== 'browser' && source !== 'server') throw new CollectionError('invalid_request', 400);
      query.source = source;
    }
    query.from = url.searchParams.get('from') ?? ''; query.to = url.searchParams.get('to') ?? '';
    const start = dateMillis(query.from), end = dateMillis(query.to);
    if (start > end || end - start >= QUERY_POLICY.maxDays * DAY) throw new CollectionError('invalid_request', 400);
    const name = match[4] ?? match[5] ?? match[7];
    if (name !== undefined) { if (!NAME.test(name)) throw new CollectionError('invalid_request', 400); query.name = name; }
    const groupBy = url.searchParams.get('groupBy');
    if ((kind === 'workflow-breakdown' || kind === 'funnel-breakdown') && groupBy === null) throw new CollectionError('invalid_request', 400);
    if (groupBy !== null) { if (!NAME.test(groupBy)) throw new CollectionError('invalid_request', 400); query.groupBy = groupBy; }
  }
  return access.store.query(principal, query, now);
}
