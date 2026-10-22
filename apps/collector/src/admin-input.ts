import { CollectionError } from '@tallyfin/core';
import type { AdminPrincipal } from '@tallyfin/core';
import type { AdministratorAccess } from './admin.ts';
import { readBody } from './body.ts';

export interface AdminContext { request: Request; url: URL; access: AdministratorAccess; principal: AdminPrincipal; now: number }

export async function readJsonBody(request: Request, maximum?: number): Promise<unknown> {
  const body = await readBody(request, maximum);
  try { return JSON.parse(body); } catch { throw new CollectionError('invalid_request', 400); }
}

export function parameters(url: URL, allowed: string[], maximumLength = 512) {
  if (url.search.length > maximumLength) throw new CollectionError('invalid_request', 400);
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new CollectionError('invalid_request', 400);
    seen.add(key);
  }
}
export function positive(value: string, maximum: number): number {
  const number = Number(value);
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(number) || number > maximum) throw new CollectionError('invalid_request', 400);
  return number;
}
