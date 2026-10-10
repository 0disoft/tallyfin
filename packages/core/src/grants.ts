import { CollectionError } from './types.ts';
import { closed, text } from './value.ts';

export type GrantRole = 'reader' | 'owner';
export interface GrantChange { issuer: string; subject: string; role: GrantRole | null; expectedRole: GrantRole | null }
export interface GrantChangeResult {
  projectId: string; issuer: string; subject: string; role: GrantRole | null; createdAt: string | null;
  canManage: boolean; changed: boolean;
}
export function validGrantIdentity(issuer: unknown, subject: unknown): boolean {
  if (!text(issuer, 1, 512) || issuer !== issuer.trim() || !text(subject, 1, 512) ||
    !subject.trim() || /[\x00-\x1f\x7f]/.test(subject)) return false;
  try {
    const url = new URL(issuer);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function role(value: unknown): value is GrantRole | null { return value === null || value === 'reader' || value === 'owner'; }
export function validateGrantChange(value: unknown): GrantChange {
  if (!closed(value, ['issuer', 'subject', 'role', 'expectedRole']) || !validGrantIdentity(value.issuer, value.subject) ||
    !role(value.role) || !role(value.expectedRole)) throw new CollectionError('invalid_request', 400);
  return { issuer: value.issuer as string, subject: value.subject as string, role: value.role, expectedRole: value.expectedRole };
}
export function parseGrantChange(value: unknown, method: 'PUT' | 'DELETE'): GrantChange {
  if (!closed(value, method === 'PUT' ? ['issuer', 'subject', 'role', 'expectedRole'] : ['issuer', 'subject', 'expectedRole']) ||
    (method === 'PUT' && value.role === null)) throw new CollectionError('invalid_request', 400);
  return validateGrantChange({ ...value, role: method === 'DELETE' ? null : value.role });
}
