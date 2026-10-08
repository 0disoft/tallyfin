import { closed, matches, record } from '@tallyfin/core';
import { resolve } from 'node:path';
import { DEFAULT_SETTINGS, configureCollector } from '../../apps/collector/src/config.ts';

/** Validates supplied identifiers only; never contacts Cloudflare or provisions resources. */
export function deploymentTarget(input: unknown, root: string) {
  try {
    if (!closed(input, ['workerName', 'accountId', 'databaseName', 'databaseId', 'workersDev', 'settings']) ||
      !matches(input.workerName, /^[a-z][a-z0-9-]{0,62}$/) ||
      !matches(input.accountId, /^[0-9a-f]{32}$/) || /^0+$/.test(input.accountId) ||
      !matches(input.databaseName, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) ||
      !matches(input.databaseId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) ||
      /^0+-0+-0+-0+-0+$/.test(input.databaseId) || typeof input.workersDev !== 'boolean' || !record(input.settings) ||
      Object.keys(input.settings).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key))) throw Error();
    const settings = { ...DEFAULT_SETTINGS, ...input.settings };
    if (settings.ADMIN_AUTH_MODE !== 'oidc' || settings.ALLOW_LOCAL_HTTP !== 'false') throw Error();
    configureCollector(settings);
    return {
      $schema: resolve(root, 'node_modules/wrangler/config-schema.json'),
      name: input.workerName, account_id: input.accountId, main: resolve(root, 'apps/collector/src/runtime.ts'),
      compatibility_date: '2026-08-06', workers_dev: input.workersDev, preview_urls: false, send_metrics: false,
      d1_databases: [{ binding: 'DB', database_name: input.databaseName, database_id: input.databaseId,
        migrations_dir: resolve(root, 'db/migrations') }],
      vars: settings, triggers: { crons: ['* * * * *'] },
      observability: { enabled: true, redact_query_string: true,
        logs: { enabled: true, invocation_logs: false, head_sampling_rate: 1 }, traces: { enabled: false } },
    };
  } catch { throw new TypeError('Invalid deployment target configuration'); }
}
