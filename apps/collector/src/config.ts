import { createWorker, createOidcWorker, createPublisherOidcWorker } from './index.ts';
import type { OidcAlgorithm, OidcOptions } from '@tallyfin/auth-oidc';

export const DEFAULT_SETTINGS = {
  ADMIN_AUTH_MODE: 'disabled', ALLOW_LOCAL_HTTP: 'false',
  OIDC_ISSUER: '', OIDC_AUDIENCE: '', OIDC_JWKS_URI: '',
  OIDC_ALGORITHMS: 'RS256', OIDC_TOKEN_TYPE: 'at+jwt', OIDC_CLOCK_TOLERANCE_SECONDS: '5',
  PUBLISHER_AUTH_MODE: 'disabled',
  PUBLISHER_OIDC_ISSUER: '', PUBLISHER_OIDC_AUDIENCE: '', PUBLISHER_OIDC_JWKS_URI: '',
  PUBLISHER_OIDC_ALGORITHMS: 'RS256', PUBLISHER_OIDC_TOKEN_TYPE: 'at+jwt', PUBLISHER_OIDC_CLOCK_TOLERANCE_SECONDS: '5',
};
export type Settings = Partial<Record<keyof typeof DEFAULT_SETTINGS, unknown>>;
export function readSettings(values: Settings): { allowLocalHttp: boolean; oidc: OidcOptions | null; publisherOidc: OidcOptions | null } {
  const invalid = (): never => { throw new TypeError('Invalid collector configuration'); };
  const get = (key: keyof typeof DEFAULT_SETTINGS): string => {
    // Existing deployments without publisher variables keep machine ingestion disabled.
    const value = values[key] === undefined && key.startsWith('PUBLISHER_') ? DEFAULT_SETTINGS[key] : values[key];
    if (typeof value !== 'string' || value !== value.trim()) return invalid();
    return value;
  };
  const local = get('ALLOW_LOCAL_HTTP');
  if (!['true', 'false'].includes(local)) return invalid();
  const readOidc = (publisher: boolean): OidcOptions | null => {
    const mode = get(publisher ? 'PUBLISHER_AUTH_MODE' : 'ADMIN_AUTH_MODE');
    if (!['disabled', 'oidc'].includes(mode)) return invalid();
    const prefix = publisher ? 'PUBLISHER_' : '';
    const issuer = get(`${prefix}OIDC_ISSUER`); const audience = get(`${prefix}OIDC_AUDIENCE`);
    const jwksUri = get(`${prefix}OIDC_JWKS_URI`); const algorithms = get(`${prefix}OIDC_ALGORITHMS`).split(',');
    const tokenType = get(`${prefix}OIDC_TOKEN_TYPE`); const tolerance = get(`${prefix}OIDC_CLOCK_TOLERANCE_SECONDS`);
    if (!algorithms.length || algorithms.some(value => !['RS256', 'ES256'].includes(value)) ||
      new Set(algorithms).size !== algorithms.length || !['at+jwt', 'JWT'].includes(tokenType) ||
      !/^(0|[1-9]\d?)$/.test(tolerance) || Number(tolerance) > 60) return invalid();
    if (mode === 'disabled') {
      if (issuer || audience || jwksUri) return invalid();
      return null;
    }
    return { issuer, audience, jwksUri, algorithms: algorithms as OidcAlgorithm[],
      tokenType: tokenType as 'at+jwt' | 'JWT', clockToleranceSeconds: Number(tolerance) };
  };
  const oidc = readOidc(false); const publisherOidc = readOidc(true);
  if (oidc && publisherOidc && oidc.audience === publisherOidc.audience) return invalid();
  return { allowLocalHttp: local === 'true', oidc, publisherOidc };
}
export function configureCollector(values: Settings) {
  try {
    const settings = readSettings(values);
    return settings.oidc ? createOidcWorker(settings.oidc, settings.publisherOidc ?? undefined) :
      settings.publisherOidc ? createPublisherOidcWorker(settings.publisherOidc) : createWorker();
  } catch { throw new TypeError('Invalid collector configuration'); }
}
export function configurationKey(values: Settings): string {
  return JSON.stringify(Object.keys(DEFAULT_SETTINGS).map(key => values[key as keyof typeof DEFAULT_SETTINGS]));
}
