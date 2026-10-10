import type { Registry } from './types.ts';
import { validateMutableSettings } from './settings.ts';
import { schemaDefinitions, validateSchemaDefinitions } from './schema.ts';
import { closed, integer, matches, PROJECT_ID, text } from './value.ts';

export function validateRegistry(value: unknown, options: { allowLocalHttp?: boolean } = {}): Registry {
  if (!closed(value, ['project', 'schemaVersion', 'schemaStatus', 'allowedOrigins', 'limits', 'events', 'workflows'], ['funnels']) ||
    !closed(value.project, ['id', 'name', 'status', 'timeZone']) || !matches(value.project.id, PROJECT_ID) ||
    !text(value.project.name, 1, 80) || !['active', 'paused'].includes(String(value.project.status)) || !text(value.project.timeZone, 1, 64) ||
    !integer(value.schemaVersion, 1, 2_147_483_647) || !['active', 'retired'].includes(String(value.schemaStatus)) ||
    !closed(value.limits, ['requestsPerMinute', 'newReceiptsPerUtcDay']) || !integer(value.limits.requestsPerMinute, 1, 600) ||
    !integer(value.limits.newReceiptsPerUtcDay, 1, 1_000_000)) throw Error('invalid registry');
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value.project.timeZone)) throw Error('invalid registry');
  new Intl.DateTimeFormat('en', { timeZone: value.project.timeZone });
  validateMutableSettings({ name: value.project.name, status: value.project.status,
    allowedOrigins: value.allowedOrigins, limits: value.limits }, options);
  validateSchemaDefinitions(schemaDefinitions(value as unknown as Registry));
  // Registration still requires the owner's privacy review; syntax cannot detect private enums.
  return structuredClone(value as unknown as Registry);
}
