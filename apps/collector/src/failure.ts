import { CollectionError, REJECTION_REASONS } from '@tallyfin/core';
import type { CollectionStore, ErrorCode, RejectionReason } from '@tallyfin/core';

export const messages: Record<ErrorCode, string> = {
  invalid_request: 'Invalid request.', invalid_event: 'Invalid or unregistered event.', unknown_schema: 'Schema is unavailable.',
  origin_denied: 'Origin is not allowed.', project_unavailable: 'Project is unavailable.',
  event_conflict: 'Event ID conflicts with a previous event.', attempt_conflict: 'Attempt conflicts with previous state.',
  settings_conflict: 'Project settings changed. Reload before saving.',
  schema_conflict: 'Schema version conflicts. Reload and review before publishing.',
  project_conflict: 'Project ID conflicts with an existing project.',
  project_limit_reached: 'Project creation limit reached.',
  grant_conflict: 'Project grant changed. Reload before saving.',
  publisher_conflict: 'Publishing permission changed. Reload before revoking.',
  last_owner: 'The last project owner cannot be removed or demoted.',
  quota_exceeded: 'Collection quota exceeded.', unauthorized: 'Authentication is required.',
  forbidden: 'Access denied.', not_found: 'Endpoint not found.', storage_unavailable: 'Storage is temporarily unavailable.',
};
/** Compute a response header snapshot without changing the request's working headers. */
export function failureHeaders(failure: CollectionError, url: string, receivedAt: number, retryAfter: number | undefined, headers: Headers): Headers {
  const result = new Headers(headers);
  if (failure.status === 401) result.set('WWW-Authenticate', 'Bearer');
  if (failure.status === 405 && !routeForCollection(url)) result.set('Allow',
    new URL(url).pathname === '/v1/projects' ? 'GET, POST' :
    /^\/v1\/projects\/[^/]+\/(grants|publishers)$/.test(new URL(url).pathname) ? 'GET, PUT, DELETE' :
    /^\/v1\/projects\/[^/]+\/schemas\/validate$/.test(new URL(url).pathname) ? 'POST' :
    /^\/v1\/projects\/[^/]+\/schemas\/[^/]+$/.test(new URL(url).pathname) ? 'GET, PUT' :
    /^\/v1\/projects\/[^/]+$/.test(new URL(url).pathname) ? 'GET, PATCH' : 'GET');
  if (failure.status === 429) {
    // Admission resumes at the next fixed minute; daily quota resumes at UTC midnight.
    result.set('Retry-After', String(retryAfter ?? Math.max(1, Math.ceil((86_400_000 - receivedAt % 86_400_000) / 1000))));
  } else if (failure.status === 503) result.set('Retry-After', '1');
  return result;
}

export async function recordRejectedRequest(store: CollectionStore, projectId: string, receivedAt: number, code: ErrorCode,
  waitUntil?: (task: Promise<void>) => void): Promise<void> {
  const reason = code === 'quota_exceeded' ? 'daily_limit' : code as RejectionReason;
  if (reason === 'minute_limit' || !REJECTION_REASONS.includes(reason)) return;
  const task = (async () => {
    try { await store.recordRejection(projectId, receivedAt, reason); } catch { /* Best effort, no retry or raw error logging. */ }
  })();
  if (!waitUntil) { await task; return; }
  try { waitUntil(task); } catch { await task; }
}
const routeForCollection = (url: string) => /^\/v1\/projects\/[^/]+\/(batches|server-batches)$/.test(new URL(url).pathname);
