import { ContractError } from './validate.ts';

export type SchemaDraft = { events: unknown[]; workflows: unknown[]; funnels?: unknown[]; representativeWorkflowId?: unknown };
export type SchemaIssueCode = 'invalid_definition' | 'definition_limit' | 'duplicate' | 'cardinality_limit' | 'browser_event_required' | 'invalid_reference' | 'dimension_mismatch';
export type SchemaValidation = { valid: boolean; issues: { path: string; code: SchemaIssueCode }[]; privacyReviewRequired: true };
export type SchemaMetadata = { schemaVersion: number; schemaStatus: 'active' | 'retired'; publishedAt: string };
export type SchemaPage = { projectId: string; latestVersion: number | null; latestActiveVersion?: number | null; data: SchemaMetadata[]; page: { limit: number; beforeVersion: number | null } };
export type PublishedSchema = SchemaMetadata & { projectId: string; definitionHash: string };
export type SchemaPublication = SchemaDraft & { expectedLatestVersion: number | null; privacyReviewed: true };
function fail(): never { throw new ContractError('Schema response is invalid.'); }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keys.every(k => Object.hasOwn(value, k)) ||
    Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) fail();
  return value as Record<string, unknown>;
}
function version(value: unknown): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) fail(); return value; }
function nullableVersion(value: unknown): number | null { return value === null ? null : version(value); }
function projectId(value: unknown): string { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(value)) fail(); return value; }
function metadata(value: unknown): SchemaMetadata {
  const r = object(value, ['schemaVersion', 'schemaStatus', 'publishedAt']);
  if (r.schemaStatus !== 'active' && r.schemaStatus !== 'retired') fail();
  if (typeof r.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(r.publishedAt) || !Number.isFinite(Date.parse(r.publishedAt))) fail();
  return { schemaVersion: version(r.schemaVersion), schemaStatus: r.schemaStatus, publishedAt: r.publishedAt };
}
export function parseSchemaPage(value: unknown): SchemaPage {
  const r = object(value, ['projectId', 'latestVersion', 'data', 'page'], ['latestActiveVersion']), page = object(r.page, ['limit', 'beforeVersion']);
  if (typeof page.limit !== 'number' || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100 || !Array.isArray(r.data) || r.data.length > page.limit) fail();
  const data = r.data.map(metadata), latestVersion = nullableVersion(r.latestVersion), cursor = nullableVersion(page.beforeVersion);
  if (data.some((row, i) => latestVersion === null || row.schemaVersion > latestVersion || (i > 0 && row.schemaVersion >= data[i - 1]!.schemaVersion)) ||
    (cursor !== null && (data.length !== page.limit || cursor !== data.at(-1)?.schemaVersion))) fail();
  const active = Object.hasOwn(r, 'latestActiveVersion') ? nullableVersion(r.latestActiveVersion) : undefined;
  if (active !== undefined && ((active !== null && (latestVersion === null || active > latestVersion)) ||
    data.some(row => row.schemaStatus === 'active' && (active === null || row.schemaVersion > active!)) ||
    data.some(row => row.schemaVersion === active && row.schemaStatus !== 'active'))) fail();
  return { projectId: projectId(r.projectId), latestVersion, ...(active !== undefined ? { latestActiveVersion: active } : {}), data, page: { limit: page.limit, beforeVersion: cursor } };
}
export function parseSchemaValidation(value: unknown): SchemaValidation {
  const r = object(value, ['valid', 'issues', 'privacyReviewRequired']);
  if (typeof r.valid !== 'boolean' || r.privacyReviewRequired !== true || !Array.isArray(r.issues) || r.issues.length !== (r.valid ? 0 : 1)) fail();
  const issues = r.issues.map(value => {
    const issue = object(value, ['path', 'code']);
    if (typeof issue.path !== 'string' || issue.path.length > 160 || !/^(?:\/(?:events|workflows)(?:\/\d+(?:\/(?:name|id|properties|dimensions|startEvent|successEvent|failureEvent|failureReasonProperty)(?:\/[a-z0-9_]+)?)?)?|\/representativeWorkflowId|\/funnels(?:\/\d+(?:\/(?:id|dimensions(?:\/\d+)?|steps\/\d+(?:\/(?:eventName|source))?))?)?)?$/.test(issue.path) ||
      !['invalid_definition', 'definition_limit', 'duplicate', 'cardinality_limit', 'browser_event_required', 'invalid_reference', 'dimension_mismatch'].includes(String(issue.code))) fail();
    return { path: issue.path, code: issue.code as SchemaIssueCode };
  });
  return { valid: r.valid, issues, privacyReviewRequired: true };
}
export function parsePublishedSchema(value: unknown): PublishedSchema {
  const r = object(value, ['projectId', 'schemaVersion', 'schemaStatus', 'publishedAt', 'definitionHash']);
  if (typeof r.definitionHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.definitionHash)) fail();
  return { ...metadata({ schemaVersion: r.schemaVersion, schemaStatus: r.schemaStatus, publishedAt: r.publishedAt }),
    projectId: projectId(r.projectId), definitionHash: r.definitionHash };
}
export function readDraft(text: string): SchemaDraft {
  const value = object(JSON.parse(text), ['events', 'workflows'], ['funnels', 'representativeWorkflowId']);
  if (!Array.isArray(value.events) || !Array.isArray(value.workflows) ||
    Object.hasOwn(value, 'funnels') && !Array.isArray(value.funnels) || new TextEncoder().encode(JSON.stringify(value)).length > 32768) fail();
  return value as SchemaDraft;
}
export function canonicalDefinitions(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : v;
  return JSON.stringify(normalize(value));
}
export async function definitionHash(value: SchemaDraft): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalDefinitions(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function schemaDefinitions(value: SchemaDraft): SchemaDraft {
  return { events: value.events, workflows: value.workflows, ...(Object.hasOwn(value, 'funnels') ? { funnels: value.funnels! } : {}),
    ...(Object.hasOwn(value, 'representativeWorkflowId') ? { representativeWorkflowId: value.representativeWorkflowId } : {}) };
}
