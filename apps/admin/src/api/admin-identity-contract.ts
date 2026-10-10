import { ContractError } from './validate.ts';
import { validGrantIdentity } from './grants-contract.ts';

export type AdminIdentity = Readonly<{ issuer: string; subject: string }>;
export function parseAdminIdentity(value: unknown): AdminIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
    !('issuer' in value) || !('subject' in value) || !validGrantIdentity(value.issuer, value.subject))
    throw new ContractError('Administrator identity response is invalid.');
  return Object.freeze({ issuer: value.issuer as string, subject: value.subject as string });
}
export function identityJson(identity: AdminIdentity): string { return JSON.stringify(parseAdminIdentity(identity), null, 2); }
