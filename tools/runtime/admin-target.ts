import { closed, matches } from '@tallyfin/core';
import { resolve } from 'node:path';

/** Produces local configuration only; supplied IDs do not prove ownership or existence. */
export function adminDeploymentTarget(input: unknown, root: string) {
  if (!closed(input, ['workerName', 'accountId', 'collectorWorkerName', 'workersDev'], ['domain']) ||
    !matches(input.workerName, /^[a-z][a-z0-9-]{0,62}$/) ||
    !matches(input.collectorWorkerName, /^[a-z][a-z0-9-]{0,62}$/) || input.workerName === input.collectorWorkerName ||
    !matches(input.accountId, /^[0-9a-f]{32}$/) || /^0+$/.test(input.accountId) ||
    typeof input.workersDev !== 'boolean' ||
    (input.domain !== undefined && (!matches(input.domain, /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/) ||
      input.domain.endsWith('.invalid') || input.domain.endsWith('.localhost') || input.domain.endsWith('.test') || input.domain.endsWith('.example'))) ||
    (!input.workersDev && input.domain === undefined)) throw new TypeError('Invalid admin deployment target configuration');
  return {
    $schema: resolve(root, 'node_modules/wrangler/config-schema.json'),
    name: input.workerName, account_id: input.accountId, main: resolve(root, 'apps/admin/worker/index.js'),
    compatibility_date: '2026-08-06', workers_dev: input.workersDev, preview_urls: false, send_metrics: false,
    assets: { directory: resolve(root, 'apps/admin/dist/client'), binding: 'ASSETS',
      not_found_handling: 'none', run_worker_first: ['/v1', '/v1/*'] },
    services: [{ binding: 'COLLECTOR', service: input.collectorWorkerName }],
    ...(input.domain === undefined ? {} : { routes: [{ pattern: input.domain, custom_domain: true }] }),
    observability: { enabled: true, redact_query_string: true,
      logs: { enabled: true, invocation_logs: false, head_sampling_rate: 1 }, traces: { enabled: false } },
  };
}
