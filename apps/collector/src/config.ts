import { createWorker, createOidcWorker } from './index.ts';
import type { OidcAlgorithm, OidcOptions } from '@tallyfin/auth-oidc';

export const DEFAULT_SETTINGS = {
  ADMIN_AUTH_MODE: 'disabled', ALLOW_LOCAL_HTTP: 'false',
  OIDC_ISSUER: '', OIDC_AUDIENCE: '', OIDC_JWKS_URI: '',
  OIDC_ALGORITHMS: 'RS256', OIDC_TOKEN_TYPE: 'at+jwt', OIDC_CLOCK_TOLERANCE_SECONDS: '5',
};
export type Settings = Partial<Record<keyof typeof DEFAULT_SETTINGS, unknown>>;
export function readSettings(values: Settings): { allowLocalHttp: boolean; oidc: OidcOptions | null } {
  const invalid = (): never => { throw new TypeError('Invalid collector configuration'); };
  const get = (key: keyof typeof DEFAULT_SETTINGS): string => {
    const value = values[key];
    if (typeof value !== 'string' || value !== value.trim()) return invalid();
    return value;
  };
  const mode = get('ADMIN_AUTH_MODE'); const local = get('ALLOW_LOCAL_HTTP');
  if (!['disabled', 'oidc'].includes(mode) || !['true', 'false'].includes(local)) return invalid();
  const issuer = get('OIDC_ISSUER'); const audience = get('OIDC_AUDIENCE'); const jwksUri = get('OIDC_JWKS_URI');
  const algorithms = get('OIDC_ALGORITHMS').split(',');
  const tokenType = get('OIDC_TOKEN_TYPE'); const tolerance = get('OIDC_CLOCK_TOLERANCE_SECONDS');
  if (!algorithms.length || algorithms.some(value => !['RS256', 'ES256'].includes(value)) ||
    new Set(algorithms).size !== algorithms.length || !['at+jwt', 'JWT'].includes(tokenType) ||
    !/^(0|[1-9]\d?)$/.test(tolerance) || Number(tolerance) > 60) return invalid();
  if (mode === 'disabled') {
    if (issuer || audience || jwksUri) return invalid();
    return { allowLocalHttp: local === 'true', oidc: null };
  }
  return { allowLocalHttp: local === 'true', oidc: {
    issuer, audience, jwksUri, algorithms: algorithms as OidcAlgorithm[],
    tokenType: tokenType as 'at+jwt' | 'JWT', clockToleranceSeconds: Number(tolerance),
  } };
}
export function configureCollector(values: Settings) {
  try {
    const settings = readSettings(values);
    return settings.oidc ? createOidcWorker(settings.oidc) : createWorker();
  } catch { throw new TypeError('Invalid collector configuration'); }
}
export function configurationKey(values: Settings): string {
  return JSON.stringify(Object.keys(DEFAULT_SETTINGS).map(key => values[key as keyof typeof DEFAULT_SETTINGS]));
}
