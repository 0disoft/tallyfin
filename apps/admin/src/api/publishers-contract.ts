// Closed contract for the owner-only server publisher list and its permission
// writes. Publisher authority is independent from administrator grants: an
// entry carries the verified issuer/subject, the immutable grant generation and
// the creation stamp, and a publisher principal never gains administrator
// access through it. The generation is non-secret concurrency metadata that
// tells a regrant apart from the permission the operator read; it is never an
// authority claim or a credential.

import type { ProjectPublisher, ProjectPublisherPage } from './types.ts';
import { ContractError } from './validate.ts';
import { validGrantIdentity } from './grants-contract.ts';

export type PublisherGrantRequest = { granted: true; issuer: string; subject: string };
export type PublisherRevokeRequest = { granted: false; issuer: string; subject: string; expectedGrantId: string | null };
export type PublisherRequest = PublisherGrantRequest | PublisherRevokeRequest;
export type PublisherMutationResult = {
  projectId: string; issuer: string; subject: string; granted: boolean;
  grantId: string | null; createdAt: string | null; changed: boolean;
};

const PROJECT = /^[a-z][a-z0-9-]{0,47}$/;
const CURSOR = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR = 12288;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GRANT_ID = /^[0-9a-f]{32}$/;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

function fail(): never { throw new ContractError('Publisher response is invalid.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))) return fail();
  return value as Record<string, unknown>;
}
/** Canonical UTC millisecond stamp; the wire never carries a coarser or offset form. */
function stamp(value: unknown): string {
  if (typeof value !== 'string' || !TIME.test(value)) return fail();
  const at = Date.parse(value);
  if (!Number.isSafeInteger(at) || at < 0 || new Date(at).toISOString() !== value) return fail();
  return value;
}
/** Immutable lowercase 32-hex grant generation; concurrency metadata, not an authority. */
function generation(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 32 || !GRANT_ID.test(value)) return fail();
  return value;
}
function identity(issuer: unknown, subject: unknown): { issuer: string; subject: string } {
  if (!validGrantIdentity(issuer, subject)) return fail();
  return { issuer: issuer as string, subject: subject as string };
}
function base64url(raw: Uint8Array): string {
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function cursorFor(projectId: string, issuer: string, subject: string): string {
  return base64url(encoder.encode(JSON.stringify(['publishers', 1, projectId, issuer, subject])));
}
/** True when the row sorts strictly after the pair in SQLite BINARY order: the UTF-8 bytes of issuer, then subject. */
export function publisherAfter(row: { issuer: string; subject: string }, previous: [string, string]): boolean {
  const pairs: [Uint8Array, Uint8Array][] = [
    [encoder.encode(row.issuer), encoder.encode(previous[0])],
    [encoder.encode(row.subject), encoder.encode(previous[1])],
  ];
  for (const [left, right] of pairs) {
    const shortest = Math.min(left.length, right.length);
    for (let index = 0; index < shortest; index++) if (left[index] !== right[index]) return left[index]! > right[index]!;
    if (left.length !== right.length) return left.length > right.length;
  }
  return false;
}
/** Decodes a base64url position and rejects other projects, list kinds and non-canonical encodings. */
export function publisherCursor(projectId: string, cursor: string | null): [string, string] | null {
  if (!cursor) return null;
  if (cursor.length > MAX_CURSOR || !CURSOR.test(cursor)) return fail();
  let value: unknown;
  try {
    const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    value = JSON.parse(decoder.decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  } catch { return fail(); }
  if (!Array.isArray(value) || value.length !== 5 || value[0] !== 'publishers' || value[1] !== 1 || value[2] !== projectId ||
    !validGrantIdentity(value[3], value[4])) return fail();
  if (cursorFor(projectId, value[3] as string, value[4] as string) !== cursor) return fail();
  return [value[3] as string, value[4] as string];
}
export function parseProjectPublisherPage(value: unknown): ProjectPublisherPage {
  const row = object(value, ['projectId', 'data', 'page']), page = object(row.page, ['limit', 'nextCursor']);
  if (typeof row.projectId !== 'string' || !PROJECT.test(row.projectId) || !Array.isArray(row.data) ||
    typeof page.limit !== 'number' || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100 ||
    row.data.length > page.limit ||
    (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor.length || row.data.length !== page.limit)))
    return fail();
  const data: ProjectPublisher[] = (row.data as unknown[]).map(entry => {
    const item = object(entry, ['issuer', 'subject', 'grantId', 'createdAt']);
    return { ...identity(item.issuer, item.subject), grantId: generation(item.grantId), createdAt: stamp(item.createdAt) };
  });
  for (const [index, item] of data.entries())
    if (index && !publisherAfter(item, [data[index - 1]!.issuer, data[index - 1]!.subject])) return fail();
  const nextCursor = page.nextCursor as string | null, last = data.at(-1), after = publisherCursor(row.projectId, nextCursor);
  if (after && (!last || after[0] !== last.issuer || after[1] !== last.subject)) return fail();
  return { projectId: row.projectId, data, page: { limit: page.limit, nextCursor } };
}
export function parsePublisherGrantRequest(value: unknown): PublisherGrantRequest {
  const row = object(value, ['granted', 'issuer', 'subject']);
  if (row.granted !== true) return fail();
  return { granted: true, ...identity(row.issuer, row.subject) };
}
export function parsePublisherRevokeRequest(value: unknown): PublisherRevokeRequest {
  const row = object(value, ['granted', 'issuer', 'subject', 'expectedGrantId']);
  if (row.granted !== false) return fail();
  return { granted: false, ...identity(row.issuer, row.subject),
    expectedGrantId: row.expectedGrantId === null ? null : generation(row.expectedGrantId) };
}
export function parsePublisherRequest(value: unknown): PublisherRequest {
  const granted = (value as { granted?: unknown } | null | undefined)?.granted;
  if (granted === true) return parsePublisherGrantRequest(value);
  if (granted === false) return parsePublisherRevokeRequest(value);
  return fail();
}
export function parsePublisherMutationResult(value: unknown): PublisherMutationResult {
  const row = object(value, ['projectId', 'issuer', 'subject', 'granted', 'grantId', 'createdAt', 'changed']);
  if (typeof row.projectId !== 'string' || !PROJECT.test(row.projectId) || typeof row.granted !== 'boolean' ||
    typeof row.changed !== 'boolean') return fail();
  const target = identity(row.issuer, row.subject);
  // A live permission carries both the generation and its creation stamp; a
  // removed one carries neither, so a stale write cannot look like a success.
  const grantId = row.grantId === null ? null : generation(row.grantId);
  const createdAt = row.createdAt === null ? null : stamp(row.createdAt);
  if ((grantId !== null) !== row.granted || (createdAt !== null) !== row.granted) return fail();
  return { projectId: row.projectId, ...target, granted: row.granted, grantId, createdAt, changed: row.changed };
}
