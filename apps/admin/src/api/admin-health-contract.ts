import { ContractError } from './validate.ts';

export type AdminHealth = Readonly<{ status: 'ok'; scope: 'administrator_storage_read' }>;
export function parseAdminHealth(value: unknown): AdminHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
    !('status' in value) || value.status !== 'ok' || !('scope' in value) || value.scope !== 'administrator_storage_read')
    throw new ContractError('Administrator storage health response is invalid.');
  return Object.freeze({ status: 'ok', scope: 'administrator_storage_read' });
}
