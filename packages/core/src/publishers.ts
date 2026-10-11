import { CollectionError } from './types.ts';
import { closed } from './value.ts';
import { validGrantIdentity } from './grants.ts';

export interface PublisherChange { issuer: string; subject: string; granted: boolean; expectedCreatedAt: string | null }
export interface PublisherChangeResult {
  projectId: string; issuer: string; subject: string; granted: boolean; createdAt: string | null; changed: boolean;
}
export function validatePublisherChange(value: unknown): PublisherChange {
  if (!closed(value, ['issuer', 'subject', 'granted', 'expectedCreatedAt']) || !validGrantIdentity(value.issuer, value.subject) ||
    typeof value.granted !== 'boolean') throw new CollectionError('invalid_request', 400);
  if (value.expectedCreatedAt !== null) {
    const stamp = value.expectedCreatedAt;
    if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp) ||
      !Number.isSafeInteger(Date.parse(stamp)) || Date.parse(stamp) < 0 || new Date(stamp).toISOString() !== stamp)
      throw new CollectionError('invalid_request', 400);
  }
  if (value.granted && value.expectedCreatedAt !== null) throw new CollectionError('invalid_request', 400);
  return { issuer: value.issuer as string, subject: value.subject as string, granted: value.granted,
    expectedCreatedAt: value.expectedCreatedAt as string | null };
}
export function parsePublisherChange(value: unknown, method: 'PUT' | 'DELETE'): PublisherChange {
  if (!closed(value, method === 'PUT' ? ['issuer', 'subject'] : ['issuer', 'subject', 'expectedCreatedAt']))
    throw new CollectionError('invalid_request', 400);
  return validatePublisherChange({ ...value, granted: method === 'PUT', expectedCreatedAt: method === 'PUT' ? null : value.expectedCreatedAt });
}
