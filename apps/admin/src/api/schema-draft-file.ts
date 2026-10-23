export const SCHEMA_DRAFT_FILE_LIMIT = 128 * 1024;
const FORMAT = 'tallyfin.schema-draft/v1';
export type SchemaDraftFile = { format: typeof FORMAT; projectId: string; targetVersion: string; draftText: string };

/** Only the envelope is validated here: unfinished JSON and version input must round-trip. */
export function parseSchemaDraftFile(text: string, projectId: string): SchemaDraftFile {
  if (new TextEncoder().encode(text).length > SCHEMA_DRAFT_FILE_LIMIT) throw Error('초안 파일은 128KiB 이하여야 해요.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error('Tallyfin에서 저장한 초안 JSON 파일을 선택해 주세요.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('초안 파일 형식을 확인해 주세요.');
  const file = value as Record<string, unknown>;
  if (Object.keys(file).length !== 4 || file.format !== FORMAT ||
    typeof file.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(file.projectId) ||
    typeof file.targetVersion !== 'string' || file.targetVersion.length > 32 || typeof file.draftText !== 'string')
    throw Error('지원하는 Tallyfin 초안 파일 형식이 아니에요.');
  if (file.projectId !== projectId) throw Error('현재 프로젝트에서 저장한 초안 파일을 선택해 주세요.');
  return file as SchemaDraftFile;
}

export function schemaDraftFile(projectId: string, targetVersion: string, draftText: string) {
  const text = JSON.stringify({ format: FORMAT, projectId, targetVersion, draftText }, null, 2) + '\n';
  parseSchemaDraftFile(text, projectId);
  return { text, filename: `tallyfin-${projectId}-schema-draft.json` };
}
