import { closed, CollectionError, dateMillis, DAY, has, MAX_PUBLICATION_BYTES, MAX_SCHEMA_BYTES, NAME, parseGrantChange, parsePublisherChange, parseSchemaPublication, parseSettingsUpdate, PROJECT_ID, validateSchemaDraft, validGrantIdentity } from '@tallyfin/core';
import { readBody } from './body.ts';
import type { AdminPrincipal, AdminQuery, AdminStore } from '@tallyfin/core';

/** The host must verify signature, issuer, audience and expiry before returning a principal. */
export interface AdministratorAccess {
  store: AdminStore;
  verifyBearer: (bearer: string) => Promise<AdminPrincipal | null>;
  /** Optional host port for a bounded, read-only administrator storage probe. */
  checkReadiness?: () => Promise<void>;
}
export async function administrator(request: Request, access: AdministratorAccess | undefined, now: number): Promise<unknown> {
  const header = request.headers.get('Authorization');
  if (!access || !header || header.length > 8192 || !/^Bearer [^\s,]+$/i.test(header)) throw new CollectionError('unauthorized', 401);
  let principal: AdminPrincipal | null;
  try { principal = await access.verifyBearer(header.slice(7)); } catch { throw new CollectionError('unauthorized', 401); }
  if (!principal || typeof principal.issuer !== 'string' || typeof principal.subject !== 'string' ||
    !principal.issuer.trim() || !principal.subject.trim() || principal.issuer.length > 512 || principal.subject.length > 512)
    throw new CollectionError('unauthorized', 401);
  const url = new URL(request.url);
  if (url.pathname === '/v1/health') {
    if (!validGrantIdentity(principal.issuer, principal.subject)) throw new CollectionError('unauthorized', 401);
    if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
    parameters(url, []);
    if (!access.checkReadiness) throw new CollectionError('storage_unavailable', 503);
    try { await access.checkReadiness(); } catch { throw new CollectionError('storage_unavailable', 503); }
    return { status: 'ok', scope: 'administrator_storage_read' };
  }
  if (url.pathname === '/v1/identity') {
    if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
    parameters(url, []);
    if (!validGrantIdentity(principal.issuer, principal.subject)) throw new CollectionError('unauthorized', 401);
    // Only the caller's verified access-token principal; no DB read or authority assignment.
    return { issuer: principal.issuer, subject: principal.subject };
  }
  const changes = /^\/v1\/projects\/([^/]+)\/changes$/.exec(url.pathname);
  if (changes) {
    if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
    if (!PROJECT_ID.test(changes[1]!)) throw new CollectionError('invalid_request', 400);
    parameters(url, ['limit', 'cursor']);
    return access.store.changes(principal, changes[1]!, positive(url.searchParams.get('limit') ?? '25', 100),
      url.searchParams.get('cursor') ?? '', now);
  }
  const publishers = /^\/v1\/projects\/([^/]+)\/publishers$/.exec(url.pathname);
  if (publishers) {
    if (!['GET', 'PUT', 'DELETE'].includes(request.method)) throw new CollectionError('invalid_request', 405);
    if (!PROJECT_ID.test(publishers[1]!)) throw new CollectionError('invalid_request', 400);
    if (request.method === 'PUT' || request.method === 'DELETE') {
      parameters(url, []);
      const project = await access.store.settings(principal, publishers[1]!);
      if (!project.canEdit) throw new CollectionError('forbidden', 403);
      const body = await readBody(request);
      let value: unknown;
      try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
      return access.store.changePublisher(principal, publishers[1]!, parsePublisherChange(value, request.method), now);
    }
    parameters(url, ['limit', 'cursor'], 12352);
    return access.store.publishers(principal, publishers[1]!, positive(url.searchParams.get('limit') ?? '25', 100),
      url.searchParams.get('cursor') ?? '');
  }
  const grants = /^\/v1\/projects\/([^/]+)\/grants$/.exec(url.pathname);
  if (grants) {
    if (!['GET', 'PUT', 'DELETE'].includes(request.method)) throw new CollectionError('invalid_request', 405);
    if (!PROJECT_ID.test(grants[1]!)) throw new CollectionError('invalid_request', 400);
    if (request.method === 'PUT' || request.method === 'DELETE') {
      parameters(url, []);
      const project = await access.store.settings(principal, grants[1]!);
      if (!project.canEdit) throw new CollectionError('forbidden', 403);
      const body = await readBody(request);
      let value: unknown;
      try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
      return access.store.changeGrant(principal, grants[1]!, parseGrantChange(value, request.method), now);
    }
    // A cursor can contain two provisioned identities of up to 512 characters each.
    parameters(url, ['limit', 'cursor'], 12352);
    return access.store.grants(principal, grants[1]!, positive(url.searchParams.get('limit') ?? '25', 100),
      url.searchParams.get('cursor') ?? '');
  }
  const rejections = /^\/v1\/projects\/([^/]+)\/collection\/rejections$/.exec(url.pathname);
  if (rejections) {
    if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
    if (!PROJECT_ID.test(rejections[1]!)) throw new CollectionError('invalid_request', 400);
    parameters(url, ['from', 'to']);
    return access.store.rejections(principal, rejections[1]!, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '', now);
  }
  if (url.pathname === '/v1/projects' && request.method === 'POST') {
    parameters(url, []);
    // Creation is a separately provisioned authority, never inferred from any project owner role.
    await access.store.creationAccess(principal);
    const body = await readBody(request);
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
    return access.store.createProject(principal, value, now);
  }
  const settings = /^\/v1\/projects\/([^/]+)$/.exec(url.pathname);
  const schemas = /^\/v1\/projects\/([^/]+)\/schemas$/.exec(url.pathname);
  if (schemas) {
    if (request.method !== 'GET') throw new CollectionError('invalid_request', 405);
    if (!PROJECT_ID.test(schemas[1]!)) throw new CollectionError('invalid_request', 400);
    parameters(url, ['limit', 'beforeVersion']);
    return access.store.schemas(principal, schemas[1]!, positive(url.searchParams.get('limit') ?? '25', 100),
      url.searchParams.has('beforeVersion') ? positive(url.searchParams.get('beforeVersion')!, 2147483647) : null);
  }
  const draft = /^\/v1\/projects\/([^/]+)\/schemas\/validate$/.exec(url.pathname);
  if (draft) {
    if (request.method !== 'POST') throw new CollectionError('invalid_request', 405);
    if (!PROJECT_ID.test(draft[1]!)) throw new CollectionError('invalid_request', 400);
    parameters(url, []);
    // Read-only validation uses the same granted project snapshot as settings, without writing a draft.
    const project = await access.store.settings(principal, draft[1]!);
    if (!project.canEdit) throw new CollectionError('forbidden', 403);
    let value: unknown;
    const body = await readBody(request, MAX_SCHEMA_BYTES);
    try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
    if (!closed(value, ['events', 'workflows'], ['funnels']) || !Array.isArray(value.events) || !Array.isArray(value.workflows) ||
      (has(value, 'funnels') && !Array.isArray(value.funnels)))
      throw new CollectionError('invalid_request', 400);
    return validateSchemaDraft(value);
  }
  const publication = /^\/v1\/projects\/([^/]+)\/schemas\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'PUT' && publication) {
    if (!PROJECT_ID.test(publication[1]!)) throw new CollectionError('invalid_request', 400);
    const version = positive(publication[2]!, 2147483647);
    parameters(url, []);
    const project = await access.store.settings(principal, publication[1]!);
    if (!project.canEdit) throw new CollectionError('forbidden', 403);
    const body = await readBody(request, MAX_PUBLICATION_BYTES);
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
    return access.store.publishSchema(principal, publication[1]!, version, parseSchemaPublication(value), now);
  }
  if (request.method !== 'GET' && !(request.method === 'PATCH' && settings)) throw new CollectionError('invalid_request', 405);
  if (settings) {
    if (!PROJECT_ID.test(settings[1]!)) throw new CollectionError('invalid_request', 400);
    parameters(url, []);
    if (request.method === 'GET') return access.store.settings(principal, settings[1]!);
    let value: unknown;
    const body = await readBody(request);
    try { value = JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
    return access.store.updateSettings(principal, settings[1]!, parseSettingsUpdate(value), now);
  }
  if (url.pathname === '/v1/projects') {
    parameters(url, ['limit', 'cursor']);
    const limit = positive(url.searchParams.get('limit') ?? '25', 100);
    const cursor = url.searchParams.get('cursor') ?? '';
    if (cursor && !PROJECT_ID.test(cursor)) throw new CollectionError('invalid_request', 400);
    return access.store.list(principal, limit, cursor);
  }
  const match = /^\/v1\/projects\/([^/]+)\/(?:schemas\/([^/]+)|(summary)|events\/([^/]+)\/daily|workflows\/([^/]+)\/(daily|breakdown)|funnels\/([^/]+)\/daily)$/.exec(url.pathname);
  if (!match) throw new CollectionError('not_found', 404);
  if (!PROJECT_ID.test(match[1]!)) throw new CollectionError('invalid_request', 400);
  const kind = match[2] ? 'registry' : match[3] ? 'summary' : match[4] ? 'event' : match[7] ? 'funnel' : match[6] === 'breakdown' ? 'workflow-breakdown' : 'workflow';
  const allowed = kind === 'registry' ? [] : kind === 'event' || kind === 'workflow-breakdown' ? ['schemaVersion', 'from', 'to', 'groupBy'] : ['schemaVersion', 'from', 'to'];
  if (kind === 'summary' || kind === 'event') allowed.push('source');
  parameters(url, allowed);
  const query: AdminQuery = { projectId: match[1]!, version: positive(match[2] ?? url.searchParams.get('schemaVersion') ?? '', 2147483647), kind };
  if (kind !== 'registry') {
    const source = url.searchParams.get('source');
    if (source !== null) {
      if (source !== 'browser' && source !== 'server') throw new CollectionError('invalid_request', 400);
      query.source = source;
    }
    query.from = url.searchParams.get('from') ?? ''; query.to = url.searchParams.get('to') ?? '';
    const start = dateMillis(query.from), end = dateMillis(query.to);
    if (start > end || end - start >= 31 * DAY) throw new CollectionError('invalid_request', 400);
    const name = match[4] ?? match[5] ?? match[7];
    if (name !== undefined) { if (!NAME.test(name)) throw new CollectionError('invalid_request', 400); query.name = name; }
    const groupBy = url.searchParams.get('groupBy');
    if (kind === 'workflow-breakdown' && groupBy === null) throw new CollectionError('invalid_request', 400);
    if (groupBy !== null) { if (!NAME.test(groupBy)) throw new CollectionError('invalid_request', 400); query.groupBy = groupBy; }
  }
  return access.store.query(principal, query, now);
}
function parameters(url: URL, allowed: string[], maximumLength = 512) {
  if (url.search.length > maximumLength) throw new CollectionError('invalid_request', 400);
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
