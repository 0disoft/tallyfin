import { closed } from '@tallyfin/core';
import { loginConfig } from '../../apps/admin/src/auth/config.ts';
import { adminDeploymentTarget } from './admin-target.ts';
import { deploymentTarget } from './target.ts';
import { resolve } from 'node:path';

/** Checks the complete topology locally; never discovers identities, grants or credentials. */
export function installation(input: unknown, root: string, outputDirectory?: string) {
  try {
    if (!closed(input, ['adminOrigin', 'admin', 'collector', 'login']) || typeof input.adminOrigin !== 'string' ||
      !closed(input.login, ['issuer', 'clientId', 'scope'], ['resource', 'idTokenAlgorithm'])) throw Error();
    const admin = adminDeploymentTarget(input.admin, root);
    const collector = deploymentTarget(input.collector, root);
    if (admin.account_id !== collector.account_id || admin.services[0]!.service !== collector.name) throw Error();
    const origin = new URL(input.adminOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== input.adminOrigin || origin.port || origin.username || origin.password ||
      !(admin.routes?.some(route => route.pattern === origin.hostname) ||
        (admin.workers_dev && new RegExp(`^${admin.name}\\.[a-z0-9-]+\\.workers\\.dev$`).test(origin.hostname)))) throw Error();
    const env = {
      VITE_OIDC_ISSUER: input.login.issuer,
      VITE_OIDC_CLIENT_ID: input.login.clientId,
      VITE_OIDC_SCOPE: input.login.scope,
      VITE_OIDC_ID_TOKEN_ALG: input.login.idTokenAlgorithm ?? 'RS256',
      ...(input.login.resource === undefined ? {} : { VITE_OIDC_RESOURCE: input.login.resource }),
    };
    const login = loginConfig(env, input.adminOrigin);
    if (!login || login.issuer !== collector.vars.OIDC_ISSUER) throw Error();
    if (outputDirectory !== undefined) admin.assets.directory = resolve(outputDirectory, 'admin-assets');
    // Public build settings are copied from validated fields only, never from the Worker settings.
    const loginSettings = { schemaVersion: 'tallyfin.admin-login/v1', origin: origin.origin, env: {
      VITE_OIDC_ISSUER: login.issuer, VITE_OIDC_CLIENT_ID: login.clientId, VITE_OIDC_SCOPE: login.scope,
      VITE_OIDC_ID_TOKEN_ALG: login.idTokenAlgorithm,
      ...(login.resource === undefined ? {} : { VITE_OIDC_RESOURCE: login.resource }),
    } };
    return { admin, collector, loginSettings, manifest: { schemaVersion: 'tallyfin.installation/v1', input }, registration: {
      schemaVersion: 'tallyfin.oidc-registration/v1', issuer: login.issuer, clientId: login.clientId,
      clientType: 'public', responseType: 'code', pkceMethod: 'S256', redirectUri: login.redirectUri,
      browserOrigin: origin.origin, scope: login.scope, idTokenAlgorithm: login.idTokenAlgorithm,
      ...(login.resource === undefined ? {} : { resource: login.resource }),
      accessToken: { issuer: collector.vars.OIDC_ISSUER, audience: collector.vars.OIDC_AUDIENCE,
        algorithms: collector.vars.OIDC_ALGORITHMS, tokenType: collector.vars.OIDC_TOKEN_TYPE },
    } };
  } catch { throw new TypeError('Invalid installation configuration'); }
}
