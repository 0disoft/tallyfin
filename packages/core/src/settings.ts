import { CollectionError } from './types.ts';
import type { Registry } from './types.ts';
import { canonicalJson, closed, has, integer, matches, sha256, text } from './value.ts';

export interface MutableProjectSettings {
  name: string; status: Registry['project']['status'];
  allowedOrigins: string[]; limits: Registry['limits'];
}
export interface ProjectSettings {
  project: Registry['project']; allowedOrigins: string[]; limits: Registry['limits']; settingsHash: string; canEdit: boolean;
}
export interface ProjectSettingsUpdate {
  expectedSettingsHash: string;
  name?: string; status?: Registry['project']['status']; allowedOrigins?: string[];
  limits?: Partial<Registry['limits']>;
}
export function validateMutableSettings(value: unknown, options: { allowLocalHttp?: boolean } = {}): MutableProjectSettings {
  if (!closed(value, ['name', 'status', 'allowedOrigins', 'limits']) || !text(value.name, 1, 80) ||
    !['active', 'paused'].includes(String(value.status)) || !closed(value.limits, ['requestsPerMinute', 'newReceiptsPerUtcDay']) ||
    !integer(value.limits.requestsPerMinute, 1, 600) || !integer(value.limits.newReceiptsPerUtcDay, 1, 1_000_000) ||
    !Array.isArray(value.allowedOrigins) || value.allowedOrigins.length < 1 || value.allowedOrigins.length > 16 ||
    new Set(value.allowedOrigins).size !== value.allowedOrigins.length) throw Error('invalid project settings');
  for (const origin of value.allowedOrigins) {
    if (!text(origin, 1, 256)) throw Error('invalid project settings');
    const url = new URL(origin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== origin || origin.includes('*') || url.username || url.password ||
      !(url.protocol === 'https:' || (options.allowLocalHttp && local && url.protocol === 'http:'))) throw Error('invalid project settings');
  }
  return structuredClone(value) as unknown as MutableProjectSettings;
}
export function parseSettingsUpdate(value: unknown): ProjectSettingsUpdate {
  const keys = ['name', 'status', 'allowedOrigins', 'limits'];
  if (!closed(value, ['expectedSettingsHash'], keys) || !matches(value.expectedSettingsHash, /^[0-9a-f]{64}$/) ||
    !keys.some(key => has(value, key)) || (has(value, 'name') && !text(value.name, 1, 80)) ||
    (has(value, 'status') && value.status !== 'active' && value.status !== 'paused') ||
    (has(value, 'allowedOrigins') && (!Array.isArray(value.allowedOrigins) || value.allowedOrigins.length < 1 ||
      value.allowedOrigins.length > 16 || value.allowedOrigins.some(origin => !text(origin, 1, 256)))) ||
    (has(value, 'limits') && (!closed(value.limits, [], ['requestsPerMinute', 'newReceiptsPerUtcDay']) ||
      Object.keys(value.limits).length === 0 ||
      (has(value.limits, 'requestsPerMinute') && !integer(value.limits.requestsPerMinute, 1, 600)) ||
      (has(value.limits, 'newReceiptsPerUtcDay') && !integer(value.limits.newReceiptsPerUtcDay, 1, 1_000_000)))))
    throw new CollectionError('invalid_request', 400);
  return structuredClone(value) as unknown as ProjectSettingsUpdate;
}
export const settingsHash = (settings: Omit<ProjectSettings, 'settingsHash' | 'canEdit'>): Promise<string> => sha256(canonicalJson(settings));
