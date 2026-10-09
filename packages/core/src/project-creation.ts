import { CollectionError } from './types.ts';
import type { Registry } from './types.ts';
import { validateMutableSettings } from './settings.ts';
import { canonicalJson, closed, matches, PROJECT_ID, sha256, text } from './value.ts';

export interface ProjectCreation {
  id: string; name: string; timeZone: string; allowedOrigins: string[]; limits: Registry['limits'];
}
export interface CreatedProject { projectId: string; createdAt: string; creationHash: string }
export function parseProjectCreation(value: unknown, options: { allowLocalHttp?: boolean } = {}): ProjectCreation {
  try {
    if (!closed(value, ['id', 'name', 'timeZone', 'allowedOrigins', 'limits']) || !matches(value.id, PROJECT_ID) ||
      !text(value.name, 1, 80) || !value.name.trim() || /[\x00-\x1f\x7f]/.test(value.name) ||
      !text(value.timeZone, 1, 64) || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value.timeZone)) throw Error();
    new Intl.DateTimeFormat('en', { timeZone: value.timeZone });
    const settings = validateMutableSettings({ name: value.name, status: 'active', allowedOrigins: value.allowedOrigins, limits: value.limits }, options);
    return { id: value.id, name: settings.name, timeZone: value.timeZone,
      allowedOrigins: settings.allowedOrigins.sort(), limits: settings.limits };
  } catch { throw new CollectionError('invalid_request', 400); }
}
export const projectCreationHash = (value: ProjectCreation) => sha256(canonicalJson(value));
