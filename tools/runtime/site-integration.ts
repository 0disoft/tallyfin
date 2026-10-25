import { closed, ENUM_VALUE, parseProjectCreation, SCHEMA_LIMITS, schemaDefinitions, validateRegistry } from '@tallyfin/core';
import { projectBrowserSchema } from '../browser/schema.mjs';
import type { EventDefinition, PropertyDefinition } from '@tallyfin/core';
import type { BrowserOptions } from '../../packages/browser/src/types.ts';

function values(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > SCHEMA_LIMITS.values ||
    input.some(value => typeof value !== 'string' || !ENUM_VALUE.test(value)) || new Set(input).size !== input.length) throw Error('Invalid public enum');
  return [...input];
}

/** New-site public configuration only. No registration, publication or privacy approval occurs here. */
export function siteIntegration(input: unknown) {
  if (!closed(input, ['project', 'allowedOrigins', 'collectorOrigin', 'locales', 'pages', 'tools', 'limits']) ||
    !closed(input.project, ['id', 'name', 'timeZone']) || typeof input.collectorOrigin !== 'string') throw Error('Invalid site input');
  const origin = new URL(input.collectorOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== input.collectorOrigin || origin.username || origin.password) throw Error('Invalid collector origin');
  const locales = values(input.locales), pages = values(input.pages), tools = values(input.tools);
  for (const locale of locales) if (Intl.getCanonicalLocales(locale)[0]?.toLowerCase() !== locale) throw Error('Invalid locale');
  const creation = parseProjectCreation({ ...input.project, allowedOrigins: input.allowedOrigins, limits: input.limits });
  if (!creation.allowedOrigins.length) throw Error('At least one browser origin is required');
  const enumeration = (list: string[], purpose: string): PropertyDefinition => ({ type: 'enum', required: true, purpose, values: [...list] });
  const locale = enumeration(locales, 'Reviewed public interface language, lowercase BCP 47');
  const tool = enumeration(tools, 'Reviewed public tool category, never input, file or user identity');
  const event = (name: string, label: string, properties: Record<string, PropertyDefinition>): EventDefinition => ({ name, label, source: 'browser', properties });
  const registry = validateRegistry({ project: { ...input.project, status: 'active' }, schemaVersion: 1, schemaStatus: 'active',
    allowedOrigins: creation.allowedOrigins, limits: creation.limits,
    events: [event('page_view', 'Page viewed', { locale, page: enumeration(pages, 'Reviewed page category, never a URL or query') }),
      event('language_changed', 'Interface language changed', { locale }),
      event('tool_started', 'Tool started', { locale, tool }), event('tool_succeeded', 'Tool succeeded', { locale, tool }),
      event('tool_failed', 'Tool failed', { locale, tool, failure_reason: enumeration(['validation', 'unsupported', 'dependency', 'timeout', 'other'], 'Reviewed failure class, never exception text') })],
    workflows: [{ id: 'tool_usage', label: 'Tool usage', source: 'browser', startEvent: 'tool_started', successEvent: 'tool_succeeded',
      failureEvent: 'tool_failed', dimensions: ['locale', 'tool'], failureReasonProperty: 'failure_reason' }], representativeWorkflowId: 'tool_usage' });
  const endpoint = `${origin.origin}/v1/projects/${creation.id}/batches`;
  const configuration = { endpoint, schema: projectBrowserSchema(registry), enabled: false };
  const draft = schemaDefinitions(registry);
  const publication = { ...draft, expectedLatestVersion: null, privacyReviewed: false };
  const template = { schemaVersion: 'tallyfin.site-integration/v1', projectId: creation.id, schemaVersionToPublish: 1,
    locales, pages, tools, endpoint, csp: { connectSrcOrigins: [origin.origin] }, registrationVerified: false, privacyReviewRequired: true };
  const requests = [
    { method: 'POST', url: `${origin.origin}/v1/projects`, bodyFile: 'project-create.json', authority: 'project_creator' },
    { method: 'POST', url: `${origin.origin}/v1/projects/${creation.id}/schemas/validate`, bodyFile: 'schema-draft.json', authority: 'project_owner' },
    { method: 'PUT', url: `${origin.origin}/v1/projects/${creation.id}/schemas/1`, bodyFile: 'schema-publication.review.json', authority: 'project_owner', blockedUntilPrivacyReview: true },
    { method: 'GET', url: `${origin.origin}/v1/projects/${creation.id}/schemas/1`, authority: 'project_reader' },
  ];
  return { registry, creation, draft, publication, configuration, template, requests, module: analyticsModule(configuration) };
}

function analyticsModule(configuration: BrowserOptions): string {
  return `import { createTallyfin, type BrowserClient, type BrowserPlatform } from '@tallyfin/browser';
const configuration = ${JSON.stringify(configuration, null, 2)} as const;
let analytics: BrowserClient | undefined;
// Call from the site's consent UI. Nothing is collected before consent.
export function setAnalyticsConsent(allowed: boolean, host?: BrowserPlatform) {
  if (!allowed) { analytics?.destroy(); analytics = undefined; return; }
  analytics ??= createTallyfin({ ...configuration, enabled: true }, host);
}
// Call once after a completed navigation; reuse the client across route changes.
export const trackPage = (page: string, locale: string) => analytics?.track('page_view', { page, locale }) ?? false;
// Call after the new language actually takes effect, using the destination locale.
export const trackLanguageChange = (locale: string) => analytics?.track('language_changed', { locale }) ?? false;
// Keep this handle for one real tool operation. Terminal dimensions retain its starting locale.
export const startTool = (tool: string, locale: string) => analytics?.start('tool_usage', { tool, locale });
// Schedules delivery; it does not promise that the server has received the batch.
export const flushAnalytics = () => analytics?.flush();
`;
}
