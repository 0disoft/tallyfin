import { createTallyfin } from '../../packages/browser/src/index.ts';
import type { BrowserPlatform, BrowserSchema } from '../../packages/browser/src/index.ts';
import schema from './browser-schema.json' with { type: 'json' };

export type Tool = 'grade' | 'loan' | 'timer';
/** Example only: no collection until the host explicitly enables this instance. */
export function createSembomAnalytics(endpoint: string, enabled = false, platform?: BrowserPlatform) {
  // JSON imports widen tuple types; check:browser-size verifies this build-time projection.
  // createTallyfin also validates the schema before attaching listeners or accepting events.
  const events = createTallyfin({ endpoint, schema: schema as unknown as BrowserSchema, enabled }, platform);
  return {
    view: (tool: Tool) => events.track('tool_view', { tool }),
    startInput: (tool: Tool) => events.start('calculation', { tool }),
    validationError: (tool: Tool, error: 'required' | 'range') => events.track('validation_error', { tool, error }),
    resultCopied: (tool: Tool) => events.track('result_copy', { tool }),
    feedbackSubmitted: (tool: Tool) => events.track('feedback_submit', { tool }),
    flush: events.flush,
    destroy: events.destroy,
  };
}
