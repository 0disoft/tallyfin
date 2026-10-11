import { ContractError } from './validate.ts';
import { validGrantIdentity, type GrantRole } from './grants-contract.ts';

export const CHANGE_FIELDS = ['name', 'status', 'allowedOrigins', 'requestsPerMinute', 'newReceiptsPerUtcDay'] as const;
export type ChangeField = typeof CHANGE_FIELDS[number];
export type AdminChangeDetail = { action: 'project.created' } |
  { action: 'project.settings_changed'; fields: ChangeField[] } |
  { action: 'schema.published' | 'schema.status_changed'; schemaVersion: number } |
  { action: 'publisher.granted' | 'publisher.revoked'; target: { issuer: string; subject: string } } |
  { action: 'grant.created' | 'grant.role_changed' | 'grant.revoked'; target: { issuer: string; subject: string };
    beforeRole: GrantRole | null; afterRole: GrantRole | null };
export type AdminChange = { id: string; occurredAt: string;
  actor: { kind: 'administrator'; issuer: string; subject: string } | { kind: 'local_operator' }; change: AdminChangeDetail };
export type AdminChangePage = { projectId: string; generatedAt: string; retentionDays: 90; coverage: 'recorded-changes-only';
  data: AdminChange[]; page: { limit: number; nextCursor: string | null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT = /^[a-z][a-z0-9-]{0,47}$/;
const fail = (): never => { throw new ContractError('Administrator history response is invalid.'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))) return fail();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function time(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail();
  const at = Date.parse(value);
  if (!Number.isSafeInteger(at) || at < 0 || new Date(at).toISOString() !== value) return fail();
  return at;
}
function role(value: unknown): value is GrantRole | null { return value === null || value === 'reader' || value === 'owner'; }
function detail(value: unknown): AdminChangeDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const action = (value as { action?: unknown }).action;
  if (action === 'project.created') { object(value, ['action']); return { action }; }
  if (action === 'project.settings_changed') {
    const row = object(value, ['action', 'fields']);
    if (!Array.isArray(row.fields) || row.fields.length < 1 || row.fields.length > 5 || new Set(row.fields).size !== row.fields.length ||
      !row.fields.every(field => CHANGE_FIELDS.includes(field))) return fail();
    return { action, fields: [...row.fields] as ChangeField[] };
  }
  if (action === 'schema.published' || action === 'schema.status_changed') {
    const row = object(value, ['action', 'schemaVersion']);
    if (!integer(row.schemaVersion, 1, 2147483647)) return fail();
    return { action, schemaVersion: row.schemaVersion };
  }
  if (action === 'grant.created' || action === 'grant.role_changed' || action === 'grant.revoked') {
    const row = object(value, ['action', 'target', 'beforeRole', 'afterRole']), target = object(row.target, ['issuer', 'subject']);
    if (!validGrantIdentity(target.issuer, target.subject) || !role(row.beforeRole) || !role(row.afterRole) ||
      (action === 'grant.created' ? row.beforeRole !== null || row.afterRole === null :
        action === 'grant.revoked' ? row.beforeRole === null || row.afterRole !== null :
        row.beforeRole === null || row.afterRole === null || row.beforeRole === row.afterRole)) return fail();
    return { action, target: { issuer: target.issuer as string, subject: target.subject as string }, beforeRole: row.beforeRole, afterRole: row.afterRole };
  }
  if (action === 'publisher.granted' || action === 'publisher.revoked') {
    const row = object(value, ['action', 'target']), target = object(row.target, ['issuer', 'subject']);
    if (!validGrantIdentity(target.issuer, target.subject)) return fail();
    return { action, target: { issuer: target.issuer as string, subject: target.subject as string } };
  }
  return fail();
}
function record(value: unknown): AdminChange {
  const row = object(value, ['id', 'occurredAt', 'actor', 'change']);
  if (typeof row.id !== 'string' || !UUID.test(row.id)) return fail();
  time(row.occurredAt);
  let actor: AdminChange['actor'];
  if (row.actor && typeof row.actor === 'object' && (row.actor as { kind?: unknown }).kind === 'administrator') {
    const source = object(row.actor, ['kind', 'issuer', 'subject']);
    if (!validGrantIdentity(source.issuer, source.subject)) return fail();
    actor = { kind: 'administrator', issuer: source.issuer as string, subject: source.subject as string };
  } else {
    const source = object(row.actor, ['kind']); if (source.kind !== 'local_operator') return fail();
    actor = { kind: 'local_operator' };
  }
  return { id: row.id, occurredAt: row.occurredAt as string, actor, change: detail(row.change) };
}
export function changeCursor(projectId: string, cursor: string | null): [number, string] | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return fail();
    const value: unknown = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== projectId ||
      !integer(value[2], 0, 8640000000000000) || typeof value[3] !== 'string' || !UUID.test(value[3])) return fail();
    const canonical = btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (canonical !== cursor) return fail();
    return [value[2], value[3]];
  } catch { return fail(); }
}
export function parseAdminChangePage(value: unknown): AdminChangePage {
  const row = object(value, ['projectId', 'generatedAt', 'retentionDays', 'coverage', 'data', 'page']), page = object(row.page, ['limit', 'nextCursor']);
  if (typeof row.projectId !== 'string' || !PROJECT.test(row.projectId) || row.retentionDays !== 90 || row.coverage !== 'recorded-changes-only' ||
    !Array.isArray(row.data) || !integer(page.limit, 1, 100) || row.data.length > page.limit ||
    (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor.length || row.data.length !== page.limit))) return fail();
  const generated = time(row.generatedAt), cutoff = Math.max(0, generated - 90 * 86400000), data = row.data.map(record);
  const ids = new Set<string>();
  for (const [i, item] of data.entries()) {
    const at = time(item.occurredAt), previous = data[i - 1];
    if (at < cutoff || at > generated || ids.has(item.id) || previous &&
      !(item.occurredAt < previous.occurredAt || item.occurredAt === previous.occurredAt && item.id < previous.id)) return fail();
    ids.add(item.id);
  }
  const cursor = page.nextCursor as string | null, position = changeCursor(row.projectId, cursor), last = data.at(-1);
  if (position && (!last || position[0] !== time(last.occurredAt) || position[1] !== last.id)) return fail();
  return { projectId: row.projectId, generatedAt: row.generatedAt as string, retentionDays: 90, coverage: 'recorded-changes-only', data,
    page: { limit: page.limit, nextCursor: cursor } };
}
