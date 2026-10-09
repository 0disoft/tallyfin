import { CollectionError } from './types.ts';
import { canonicalJson, closed, integer } from './value.ts';
import { SchemaDefinitionError, validateSchemaDefinitions } from './schema.ts';
import type { SchemaDefinitions } from './schema.ts';

export const MAX_PUBLICATION_BYTES = 33 * 1024;
export interface SchemaPublication extends SchemaDefinitions { expectedLatestVersion: number | null; privacyReviewed: true }
export interface PublishedSchema {
  projectId: string; schemaVersion: number; schemaStatus: 'active' | 'retired'; definitionHash: string; publishedAt: string;
}
export interface SchemaPage {
  projectId: string; latestVersion: number | null;
  data: { schemaVersion: number; schemaStatus: 'active' | 'retired'; publishedAt: string }[];
  page: { limit: number; beforeVersion: number | null };
}
export function parseSchemaPublication(value: unknown): SchemaPublication {
  if (!closed(value, ['expectedLatestVersion', 'privacyReviewed', 'events', 'workflows']) || value.privacyReviewed !== true ||
    (value.expectedLatestVersion !== null && !integer(value.expectedLatestVersion, 1, 2147483647)))
    throw new CollectionError('invalid_request', 400);
  const definitions = { events: value.events, workflows: value.workflows };
  try { validateSchemaDefinitions(definitions); }
  catch (error) {
    if (!(error instanceof SchemaDefinitionError)) throw error;
    throw new CollectionError('invalid_request', 400);
  }
  // Normalize the persisted representation; key ordering does not change retry identity.
  return JSON.parse(canonicalJson(value)) as SchemaPublication;
}
