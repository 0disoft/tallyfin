// Pure cross-response checks that keep the UI from inventing values.
// Server-source events have no aggregation endpoint in this contract, so they
// must never be rendered as zero; and a summary that omits a registered browser
// event is a contract violation rather than an implicit zero.

import type { Registry, SummaryResponse } from './types.ts';

export function missingBrowserEvents(registry: Registry, summary: SummaryResponse): string[] {
  const seen = new Set(summary.events.map(item => item.name));
  return registry.events
    .filter(definition => definition.source === 'browser' && !seen.has(definition.name))
    .map(definition => definition.name);
}
