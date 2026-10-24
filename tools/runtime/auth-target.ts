import { closed, matches } from '@tallyfin/core';
import { resolve } from 'node:path';
import type { installation } from './installation.ts';

/** Bind the optional provider to an already validated installation; never provision or infer secrets. */
export function authDeploymentTarget(input: unknown, plan: ReturnType<typeof installation>, root: string) {
  if (!closed(input, ['workerName', 'databaseName', 'databaseId', 'adminEmail', 'workersDev'], ['domain']) ||
    !matches(input.workerName, /^[a-z][a-z0-9-]{0,62}$/) ||
    [plan.admin.name, plan.collector.name].includes(input.workerName) ||
    !matches(input.databaseName, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) ||
    !matches(input.databaseId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) ||
    /^0+-0+-0+-0+-0+$/.test(input.databaseId) || input.databaseId === plan.collector.d1_databases[0]!.database_id ||
    !matches(input.adminEmail, /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{1,63}$/) || input.adminEmail.length > 254 ||
    typeof input.workersDev !== 'boolean') throw new TypeError('Invalid authentication target');
  const issuer = new URL(plan.registration.issuer), admin = plan.registration.browserOrigin;
  const domain = input.domain;
  if (issuer.pathname !== '/api/auth' || issuer.search || issuer.hash || issuer.origin === admin || issuer.port ||
    (domain !== undefined && (domain !== issuer.hostname || issuer.hostname.endsWith('.workers.dev'))) ||
    (domain === undefined && (!input.workersDev || !new RegExp(`^${input.workerName}\\.[a-z0-9-]+\\.workers\\.dev$`).test(issuer.hostname))) ||
    plan.registration.clientId !== 'tallyfin-admin' || plan.registration.scope !== 'openid profile offline_access' ||
    plan.registration.resource !== `${admin}/v1` || plan.registration.idTokenAlgorithm !== 'ES256' ||
    plan.registration.accessToken.audience !== `${admin}/v1` || plan.registration.accessToken.algorithms !== 'ES256' ||
    plan.registration.accessToken.tokenType !== 'at+jwt' || plan.collector.vars.OIDC_JWKS_URI !== `${issuer.origin}/api/auth/jwks`)
    throw new TypeError('Authentication topology does not match installation');
  return {
    $schema: resolve(root, 'node_modules/wrangler/config-schema.json'),
    name: input.workerName, account_id: plan.collector.account_id, main: resolve(root, 'apps/auth/src/runtime.ts'),
    compatibility_date: '2026-10-24', compatibility_flags: ['nodejs_compat'],
    workers_dev: input.workersDev, preview_urls: false, send_metrics: false,
    triggers: { crons: ['17 * * * *'] },
    ...(domain === undefined ? {} : { routes: [{ pattern: domain, custom_domain: true }] }),
    d1_databases: [{ binding: 'AUTH_DB', database_name: input.databaseName, database_id: input.databaseId,
      migrations_dir: resolve(root, 'apps/auth/migrations') }],
    vars: { AUTH_ORIGIN: issuer.origin, ADMIN_ORIGIN: admin, ADMIN_EMAIL: input.adminEmail.toLowerCase() },
    secrets: { required: ['BETTER_AUTH_SECRET'] },
    observability: { enabled: true, redact_query_string: true,
      logs: { enabled: true, invocation_logs: false, head_sampling_rate: 1 }, traces: { enabled: false } },
  };
}
