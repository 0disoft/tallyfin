import { QUERY_POLICY, SCHEMA_LIMITS } from '@tallyfin/core';
import { closed, CollectionError, has, MAX_PUBLICATION_BYTES, MAX_SCHEMA_BYTES, parseGrantChange, parsePublisherChange, parseSchemaPublication, parseSettingsUpdate, PROJECT_ID, validateSchemaDraft } from '@tallyfin/core';
import { parameters, positive, readJsonBody } from './admin-input.ts';
import type { AdminContext } from './admin-input.ts';

export async function publishersRoute({ request, url, access, principal, now }: AdminContext, id: string): Promise<unknown> {
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  if (request.method === 'PUT' || request.method === 'DELETE') {
    parameters(url, []);
    const project = await access.store.settings(principal, id);
    if (!project.canEdit) throw new CollectionError('forbidden', 403);
    const value = await readJsonBody(request);
    return access.store.changePublisher(principal, id, parsePublisherChange(value, request.method), now);
  }
  parameters(url, ['limit', 'cursor'], QUERY_POLICY.maxIdentityCursorQueryChars);
  return access.store.publishers(principal, id, positive(url.searchParams.get('limit') ?? String(QUERY_POLICY.defaultPageSize), QUERY_POLICY.maxPageSize),
    url.searchParams.get('cursor') ?? '');
}

export async function grantsRoute({ request, url, access, principal, now }: AdminContext, id: string): Promise<unknown> {
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  if (request.method === 'PUT' || request.method === 'DELETE') {
    parameters(url, []);
    const project = await access.store.settings(principal, id);
    if (!project.canEdit) throw new CollectionError('forbidden', 403);
    const value = await readJsonBody(request);
    return access.store.changeGrant(principal, id, parseGrantChange(value, request.method), now);
  }
  // A cursor can contain two provisioned identities of up to 512 characters each.
  parameters(url, ['limit', 'cursor'], QUERY_POLICY.maxIdentityCursorQueryChars);
  return access.store.grants(principal, id, positive(url.searchParams.get('limit') ?? String(QUERY_POLICY.defaultPageSize), QUERY_POLICY.maxPageSize),
    url.searchParams.get('cursor') ?? '');
}

export async function createRoute({ request, url, access, principal, now }: AdminContext): Promise<unknown> {
  parameters(url, []);
  // Creation is a separately provisioned authority, never inferred from any project owner role.
  await access.store.creationAccess(principal);
  const value = await readJsonBody(request);
  return access.store.createProject(principal, value, now);
}

export async function draftRoute({ request, url, access, principal }: AdminContext, id: string): Promise<unknown> {
  if (request.method !== 'POST') throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  parameters(url, []);
  // Read-only validation uses the same granted project snapshot as settings, without writing a draft.
  const project = await access.store.settings(principal, id);
  if (!project.canEdit) throw new CollectionError('forbidden', 403);
  const value = await readJsonBody(request, MAX_SCHEMA_BYTES);
  if (!closed(value, ['events', 'workflows'], ['funnels', 'representativeWorkflowId']) || !Array.isArray(value.events) || !Array.isArray(value.workflows) ||
    (has(value, 'funnels') && !Array.isArray(value.funnels)))
    throw new CollectionError('invalid_request', 400);
  return validateSchemaDraft(value);
}

export async function publishRoute({ request, url, access, principal, now }: AdminContext, id: string, versionText: string): Promise<unknown> {
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  const version = positive(versionText, SCHEMA_LIMITS.maxVersion);
  parameters(url, []);
  const project = await access.store.settings(principal, id);
  if (!project.canEdit) throw new CollectionError('forbidden', 403);
  const value = await readJsonBody(request, MAX_PUBLICATION_BYTES);
  return access.store.publishSchema(principal, id, version, parseSchemaPublication(value), now);
}

export async function settingsRoute({ request, url, access, principal, now }: AdminContext, id: string): Promise<unknown> {
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  parameters(url, []);
  if (request.method === 'GET') return access.store.settings(principal, id);
  const value = await readJsonBody(request);
  return access.store.updateSettings(principal, id, parseSettingsUpdate(value), now);
}
