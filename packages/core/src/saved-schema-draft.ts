import { CollectionError } from './types.ts';
import { closed, PROJECT_ID } from './value.ts';

export const SAVED_SCHEMA_DRAFT_POLICY = Object.freeze({ fileBytes: 128 * 1024, requestBytes: 129 * 1024, versionChars: 32 });
export const DRAFT_REVISION = /^[0-9a-f]{32}$/;
export interface SaveSchemaDraft { expectedRevision: string | null; targetVersion: string; draftText: string }
export interface SavedSchemaDraft { revision: string; targetVersion: string; draftText: string; updatedAt: string }
export interface SchemaDraftSnapshot { projectId: string; draft: SavedSchemaDraft | null }

/** Preserve unfinished JSON/version input; only validate the bounded control-plane envelope. */
export function parseSaveSchemaDraft(value: unknown, projectId: string): SaveSchemaDraft {
  if (!PROJECT_ID.test(projectId) || !closed(value, ['expectedRevision', 'targetVersion', 'draftText']) ||
    (value.expectedRevision !== null && (typeof value.expectedRevision !== 'string' || !DRAFT_REVISION.test(value.expectedRevision))) ||
    typeof value.targetVersion !== 'string' || value.targetVersion.length > SAVED_SCHEMA_DRAFT_POLICY.versionChars || typeof value.draftText !== 'string')
    throw new CollectionError('invalid_request', 400);
  // Exactly the existing downloadable file budget, including JSON escapes and Unicode.
  const file = JSON.stringify({ format: 'tallyfin.schema-draft/v1', projectId, targetVersion: value.targetVersion, draftText: value.draftText }, null, 2) + '\n';
  if (new TextEncoder().encode(file).byteLength > SAVED_SCHEMA_DRAFT_POLICY.fileBytes) throw new CollectionError('invalid_request', 413);
  return { expectedRevision: value.expectedRevision, targetVersion: value.targetVersion, draftText: value.draftText };
}
