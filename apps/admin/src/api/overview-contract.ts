import { ContractError } from './validate.ts';
import type { EventSource } from './types.ts';

export const OVERVIEW_PAGE_SIZE = 5;
export type OverviewRow = { projectId: string; version: number | null; latestReceivedAt: string | null;
  events: number | null; previousEvents: number | null; workflowLabel: string | null;
  completion: number | null; previousCompletion: number | null; workflowUnavailable: boolean;
  rejected: number | null; rejectionUnavailable: boolean; error: boolean; accessDenied: boolean };
export type OverviewResponse = { source: EventSource; generatedAt: string; data: OverviewRow[] };
const fail = (): never => { throw new ContractError('Service overview response is inconsistent.'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail();
  return value as Record<string, unknown>;
}
function stamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function validateOverviewIds(ids: readonly string[]) {
  if (ids.length < 1 || ids.length > OVERVIEW_PAGE_SIZE || new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9-]{0,47}$/.test(id))) throw new RangeError('Invalid service overview page');
}
export function parseOverview(value: unknown): OverviewResponse {
  const r = object(value, ['source', 'generatedAt', 'data']);
  if (!['browser', 'server'].includes(String(r.source)) || !stamp(r.generatedAt) || !Array.isArray(r.data) || r.data.length < 1 || r.data.length > OVERVIEW_PAGE_SIZE) fail();
  const data = (r.data as unknown[]).map(value => {
    const row = object(value, ['projectId', 'version', 'latestReceivedAt', 'events', 'previousEvents', 'workflowLabel',
      'completion', 'previousCompletion', 'workflowUnavailable', 'rejected', 'rejectionUnavailable', 'error', 'accessDenied']);
    if (typeof row.projectId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(row.projectId) ||
      row.version !== null && (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1 || row.version > 2147483647) ||
      row.latestReceivedAt !== null && !stamp(row.latestReceivedAt) ||
      ['events', 'previousEvents', 'rejected'].some(k => row[k] !== null && (typeof row[k] !== 'number' || !Number.isSafeInteger(row[k]) || row[k] < 0)) ||
      ['completion', 'previousCompletion'].some(k => row[k] !== null && (typeof row[k] !== 'number' || !Number.isFinite(row[k]) || row[k] < 0 || row[k] > 100)) ||
      row.workflowLabel !== null && (typeof row.workflowLabel !== 'string' || row.workflowLabel.length < 1 || row.workflowLabel.length > 80) ||
      ['workflowUnavailable', 'rejectionUnavailable', 'error', 'accessDenied'].some(k => typeof row[k] !== 'boolean')) fail();
    if (row.accessDenied && !row.error || row.error &&
      ['version', 'latestReceivedAt', 'events', 'previousEvents', 'workflowLabel', 'completion', 'previousCompletion', 'rejected'].some(k => row[k] !== null) ||
      row.error && (row.workflowUnavailable || row.rejectionUnavailable) ||
      row.version === null && (row.workflowUnavailable || ['events', 'previousEvents', 'workflowLabel', 'completion', 'previousCompletion'].some(k => row[k] !== null)) ||
      row.version !== null && !row.error && (row.events === null || row.previousEvents === null) ||
      row.workflowUnavailable && (row.workflowLabel === null || row.completion !== null || row.previousCompletion !== null) ||
      row.workflowLabel === null && (row.completion !== null || row.previousCompletion !== null) ||
      row.rejectionUnavailable && row.rejected !== null ||
      r.source === 'server' && (row.workflowLabel !== null || row.workflowUnavailable)) fail();
    return row as OverviewRow;
  });
  if (new Set(data.map(row => row.projectId)).size !== data.length) fail();
  return { source: r.source as EventSource, generatedAt: r.generatedAt as string, data };
}
