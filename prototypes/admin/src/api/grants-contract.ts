import type { ProjectGrant, ProjectGrantPage } from './types.ts';
import { ContractError } from './validate.ts';

function fail(): never { throw new ContractError('Grant response is invalid.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))) fail();
  return value as Record<string, unknown>;
}
function grant(value: unknown): ProjectGrant {
  const row = object(value, ['issuer', 'subject', 'role', 'createdAt']);
  if (typeof row.issuer !== 'string' || !row.issuer.length || row.issuer.length > 512 || row.issuer !== row.issuer.trim() ||
    typeof row.subject !== 'string' || !row.subject.trim() || row.subject.length > 512 || /[\x00-\x1f\x7f]/.test(row.subject) ||
    (row.role !== 'reader' && row.role !== 'owner') || typeof row.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(row.createdAt)) || new Date(row.createdAt).toISOString() !== row.createdAt) fail();
  try {
    const url = new URL(row.issuer);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail();
  } catch { fail(); }
  return { issuer: row.issuer, subject: row.subject, role: row.role, createdAt: row.createdAt };
}
export function parseProjectGrantPage(value: unknown): ProjectGrantPage {
  const row = object(value, ['projectId', 'data', 'page']), page = object(row.page, ['limit', 'nextCursor']);
  if (typeof row.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(row.projectId) || !Array.isArray(row.data) ||
    typeof page.limit !== 'number' || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100 || row.data.length > page.limit ||
    (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor.length > 12288 ||
      !/^[A-Za-z0-9_-]+$/.test(page.nextCursor) || row.data.length !== page.limit))) fail();
  const data = row.data.map(grant), ids = data.map(g => JSON.stringify([g.issuer, g.subject]));
  if (new Set(ids).size !== ids.length) fail();
  return { projectId: row.projectId, data, page: { limit: page.limit, nextCursor: page.nextCursor as string | null } };
}
