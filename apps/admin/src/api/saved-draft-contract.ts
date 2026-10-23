import { ContractError } from './validate.ts';
import { schemaDraftFile } from './schema-draft-file.ts';

export type DraftContent = { targetVersion: string; draftText: string };
export type SavedDraft = DraftContent & { revision: string; updatedAt: string };
export type DraftSnapshot = { projectId: string; draft: SavedDraft | null };
export type SaveDraft = DraftContent & { expectedRevision: string | null };
const revision = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value, k)))
    throw new ContractError('서버 초안 응답 형식이 달라요.');
  return value as Record<string, unknown>;
}
export function validateDraftInput(projectId: string, input: SaveDraft): void {
  object(input, ['expectedRevision', 'targetVersion', 'draftText']);
  if (input.expectedRevision !== null && !revision(input.expectedRevision)) throw new ContractError('서버 초안 revision이 올바르지 않아요.');
  schemaDraftFile(projectId, input.targetVersion, input.draftText);
}
export function parseDraftSnapshot(value: unknown): DraftSnapshot {
  const r = object(value, ['projectId', 'draft']);
  if (typeof r.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(r.projectId)) throw new ContractError('서버 초안 프로젝트가 올바르지 않아요.');
  if (r.draft === null) return { projectId: r.projectId, draft: null };
  const d = object(r.draft, ['revision', 'targetVersion', 'draftText', 'updatedAt']);
  if (!revision(d.revision) || typeof d.targetVersion !== 'string' || typeof d.draftText !== 'string' ||
    typeof d.updatedAt !== 'string' || !Number.isFinite(Date.parse(d.updatedAt)) || new Date(d.updatedAt).toISOString() !== d.updatedAt)
    throw new ContractError('서버 초안 메타데이터가 올바르지 않아요.');
  try { schemaDraftFile(r.projectId, d.targetVersion, d.draftText); }
  catch { throw new ContractError('서버 초안이 허용 크기나 형식과 달라요.'); }
  return { projectId: r.projectId, draft: { revision: d.revision, targetVersion: d.targetVersion, draftText: d.draftText, updatedAt: d.updatedAt } };
}
