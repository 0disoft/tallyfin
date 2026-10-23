import { CollectionError, parseSaveSchemaDraft, PROJECT_ID, SAVED_SCHEMA_DRAFT_POLICY } from '@tallyfin/core';
import { parameters, readJsonBody, type AdminContext } from './admin-input.ts';

export async function savedSchemaDraftRoute({ request, url, access, principal, now }: AdminContext, id: string) {
  if (!['GET', 'PUT'].includes(request.method)) throw new CollectionError('invalid_request', 405);
  if (!PROJECT_ID.test(id)) throw new CollectionError('invalid_request', 400);
  parameters(url, []);
  const settings = await access.store.settings(principal, id);
  if (!settings.canEdit) throw new CollectionError('forbidden', 403);
  if (request.method === 'GET') {
    if (!access.store.schemaDraft) throw new CollectionError('storage_unavailable', 503);
    return access.store.schemaDraft(principal, id);
  }
  if (!access.store.saveSchemaDraft) throw new CollectionError('storage_unavailable', 503);
  const input = parseSaveSchemaDraft(await readJsonBody(request, SAVED_SCHEMA_DRAFT_POLICY.requestBytes), id);
  request.signal.throwIfAborted();
  return access.store.saveSchemaDraft(principal, id, input, now);
}
