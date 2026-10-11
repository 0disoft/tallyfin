import { CollectionError } from './types.ts';
import { closed } from './value.ts';
import { validGrantIdentity } from './grants.ts';

export function validPublisherGrantId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 32 && /^[0-9a-f]{32}$/.test(value);
}
export interface PublisherChange { issuer: string; subject: string; granted: boolean; expectedGrantId: string | null }
export interface PublisherChangeResult {
  projectId: string; issuer: string; subject: string; granted: boolean; createdAt: string | null; grantId: string | null; changed: boolean;
}
export function validatePublisherChange(value: unknown): PublisherChange {
  if (!closed(value, ['issuer', 'subject', 'granted', 'expectedGrantId']) || !validGrantIdentity(value.issuer, value.subject) ||
    typeof value.granted !== 'boolean') throw new CollectionError('invalid_request', 400);
  if (value.expectedGrantId !== null && !validPublisherGrantId(value.expectedGrantId))
    throw new CollectionError('invalid_request', 400);
  if (value.granted && value.expectedGrantId !== null) throw new CollectionError('invalid_request', 400);
  return { issuer: value.issuer as string, subject: value.subject as string, granted: value.granted,
    expectedGrantId: value.expectedGrantId as string | null };
}
export function parsePublisherChange(value: unknown, method: 'PUT' | 'DELETE'): PublisherChange {
  if (!closed(value, method === 'PUT' ? ['issuer', 'subject'] : ['issuer', 'subject', 'expectedGrantId']))
    throw new CollectionError('invalid_request', 400);
  return validatePublisherChange({ ...value, granted: method === 'PUT', expectedGrantId: method === 'PUT' ? null : value.expectedGrantId });
}
