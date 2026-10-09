import { ContractError } from './validate.ts';
import { canonicalDefinitions } from './schema-contract.ts';
import type { CollectionLimits } from './types.ts';

export type ProjectCreation = { id: string; name: string; timeZone: string; allowedOrigins: string[]; limits: CollectionLimits };
export type CreatedProject = { projectId: string; createdAt: string; creationHash: string };
export type CreationDraft = { id: string; name: string; timeZone: string; origins: string; requestsPerMinute: string; newReceiptsPerUtcDay: string };
export type CreationErrors = Partial<Record<keyof CreationDraft, string>>;
export const initialCreationDraft = (): CreationDraft => ({ id: '', name: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  origins: '', requestsPerMinute: '120', newReceiptsPerUtcDay: '100000' });
export function creationInput(draft: CreationDraft): { input: ProjectCreation; errors: CreationErrors } {
  const errors: CreationErrors = {}, id = draft.id.trim(), name = draft.name.trim(), timeZone = draft.timeZone.trim();
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) errors.id = '영문 소문자로 시작하는 1~48자의 소문자·숫자·하이픈을 입력해 주세요.';
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) errors.name = '프로젝트 이름을 1~80자로 입력해 주세요.';
  try { if (!/^[A-Za-z][A-Za-z0-9_+./-]{0,63}$/.test(timeZone)) throw Error(); new Intl.DateTimeFormat('en', { timeZone }); }
  catch { errors.timeZone = 'Asia/Seoul, UTC처럼 유효한 IANA 시간대를 입력해 주세요.'; }
  const allowedOrigins = draft.origins.split(/\r?\n/).map(v => v.trim()).filter(Boolean).sort();
  if (!allowedOrigins.length || allowedOrigins.length > 16 || new Set(allowedOrigins).size !== allowedOrigins.length) errors.origins = '출처를 중복 없이 1~16개 입력해 주세요.';
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (origin.length > 256 || origin !== url.origin || url.username || url.password || origin.includes('*') ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error();
    } catch { errors.origins = 'https://example.com처럼 경로 없이 정확한 출처를 입력해 주세요.'; }
  }
  const limit = (key: 'requestsPerMinute' | 'newReceiptsPerUtcDay', max: number) => {
    const value = Number(draft[key]);
    if (!/^\d+$/.test(draft[key]) || !Number.isSafeInteger(value) || value < 1 || value > max) errors[key] = `1~${max.toLocaleString('ko-KR')} 사이 정수를 입력해 주세요.`;
    return value;
  };
  const input = { id, name, timeZone, allowedOrigins, limits: { requestsPerMinute: limit('requestsPerMinute', 600), newReceiptsPerUtcDay: limit('newReceiptsPerUtcDay', 1000000) } };
  if (new TextEncoder().encode(JSON.stringify(input)).length > 16384) errors.origins = '전체 생성 요청은 16KiB 이하여야 해요.';
  return { input, errors };
}
export function parseCreatedProject(value: unknown): CreatedProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Invalid project creation receipt.');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 3 || !Object.hasOwn(r, 'projectId') || !Object.hasOwn(r, 'createdAt') || !Object.hasOwn(r, 'creationHash') ||
    typeof r.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(r.projectId) || typeof r.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdAt) || !Number.isFinite(Date.parse(r.createdAt)) ||
    new Date(r.createdAt).toISOString() !== r.createdAt || typeof r.creationHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.creationHash))
    throw new ContractError('Invalid project creation receipt.');
  return { projectId: r.projectId, createdAt: r.createdAt, creationHash: r.creationHash };
}
export async function creationHash(input: ProjectCreation): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalDefinitions({ ...input, allowedOrigins: [...input.allowedOrigins].sort() })));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
