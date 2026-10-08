import { CollectionError } from './types.ts';
import type { Properties } from './types.ts';

export const MAX_BODY_BYTES = 16 * 1024;
export const DAY = 86_400_000;
export const NAME = /^[a-z][a-z0-9_]{0,47}$/;
export const PROJECT_ID = /^[a-z][a-z0-9-]{0,47}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ENUM_VALUE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const has = (object: object, key: string): boolean => Object.hasOwn(object, key);
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function closed(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return record(value) && required.every(key => has(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function text(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}
export function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
export function utcMillis(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value))
    throw new CollectionError('invalid_event', 422);
  const milliseconds = Date.parse(value);
  const canonical = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, digits: string) => `.${digits.padEnd(3, '0')}Z`) : value.replace('Z', '.000Z');
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== canonical)
    throw new CollectionError('invalid_event', 422);
  return milliseconds;
}
export function localDate(milliseconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(milliseconds);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function dimensionKey(properties: Properties, keys = Object.keys(properties)): string {
  const value = JSON.stringify([...keys].sort().map(key => has(properties, key)
    ? [key, typeof properties[key], properties[key]] : [key, 'absent']));
  if (new TextEncoder().encode(value).byteLength > 512) throw new CollectionError('invalid_event', 422);
  return value;
}
export function canonicalEvent(projectId: string, batchVersion: number, event: import('./types.ts').BrowserEvent): string {
  return JSON.stringify([projectId, batchVersion, 'browser', event.eventId, event.name,
    event.occurredAt, dimensionKey(event.properties), event.attempt
      ? [event.attempt.workflowId, event.attempt.attemptId, event.attempt.startedAt] : null]);
}
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
