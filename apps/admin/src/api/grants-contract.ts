import type { ProjectGrant, ProjectGrantPage } from './types.ts';
import { ContractError } from './validate.ts';

export type GrantRole = 'reader' | 'owner';
export type GrantChange = { issuer: string; subject: string; role: GrantRole | null; expectedRole: GrantRole | null };
export type GrantMutationResult = {
  projectId: string; issuer: string; subject: string; role: GrantRole | null;
  createdAt: string | null; canManage: boolean; changed: boolean;
};

function fail(): never { throw new ContractError('Grant response is invalid.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))) fail();
  return value as Record<string, unknown>;
}
export function validGrantIdentity(issuer: unknown, subject: unknown): boolean {
  if (typeof issuer !== 'string' || !issuer.length || issuer.length > 512 || issuer !== issuer.trim() ||
    typeof subject !== 'string' || !subject.trim() || subject.length > 512 || /[\x00-\x1f\x7f]/.test(subject)) return false;
  try {
    const url = new URL(issuer);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function role(value: unknown): value is GrantRole | null { return value === null || value === 'reader' || value === 'owner'; }
export function parseGrantChangeInput(value: unknown): GrantChange {
  const row = object(value, ['issuer', 'subject', 'role', 'expectedRole']);
  if (!validGrantIdentity(row.issuer, row.subject) || !role(row.role) || !role(row.expectedRole)) fail();
  return { issuer: row.issuer as string, subject: row.subject as string, role: row.role, expectedRole: row.expectedRole };
}
function grant(value: unknown): ProjectGrant {
  const row = object(value, ['issuer', 'subject', 'role', 'createdAt']);
  if (!validGrantIdentity(row.issuer, row.subject) || (row.role !== 'reader' && row.role !== 'owner') ||
    typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || new Date(row.createdAt).toISOString() !== row.createdAt) fail();
  return { issuer: row.issuer as string, subject: row.subject as string, role: row.role, createdAt: row.createdAt };
}
export function parseGrantMutationResult(value: unknown): GrantMutationResult {
  const row = object(value, ['projectId', 'issuer', 'subject', 'role', 'createdAt', 'canManage', 'changed']);
  if (typeof row.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(row.projectId) ||
    !validGrantIdentity(row.issuer, row.subject) || !role(row.role) || typeof row.canManage !== 'boolean' || typeof row.changed !== 'boolean') fail();
  if (row.role === null) { if (row.createdAt !== null) fail(); }
  else grant({ issuer: row.issuer, subject: row.subject, role: row.role, createdAt: row.createdAt });
  return row as GrantMutationResult;
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
