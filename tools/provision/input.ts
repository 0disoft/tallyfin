import { closed, PROJECT_ID, text, validateRegistry } from '@tallyfin/core';
import type { Registry } from '@tallyfin/core';

export type Operation = { kind: 'register'; registry: Registry } |
  { kind: 'grant' | 'revoke'; projectId: string; issuer: string; subject: string; role: 'reader' | 'owner' | null };
export class ProvisionError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) { super(message, options); this.code = code; }
}
export function operation(kind: string, input: unknown, allowLocalHttp = false): Operation {
  try {
    if (kind === 'register') {
      const registry = validateRegistry(input, { allowLocalHttp });
      registry.allowedOrigins.sort();
      return { kind, registry };
    }
    if ((kind !== 'grant' && kind !== 'revoke') || !closed(input,
      ['projectId', 'issuer', 'subject', ...(kind === 'grant' ? ['role'] : [])]) ||
      typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId) ||
      !text(input.issuer, 1, 512) || !text(input.subject, 1, 512) || !input.subject.trim() ||
      /[\x00-\x1f\x7f]/.test(input.subject) ||
      (kind === 'grant' && !['reader', 'owner'].includes(String(input.role)))) throw Error();
    const issuer = new URL(input.issuer);
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash ||
      input.issuer !== input.issuer.trim()) throw Error();
    return { kind, projectId: input.projectId, issuer: input.issuer, subject: input.subject,
      role: kind === 'grant' ? input.role as 'reader' | 'owner' : null };
  } catch { throw new ProvisionError('invalid_input', '등록 형식·출처·스키마·관리자 식별값을 확인해 주세요.'); }
}
