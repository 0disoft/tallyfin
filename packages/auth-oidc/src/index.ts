import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from 'jose';

export type OidcAlgorithm = 'RS256' | 'ES256';
export interface OidcOptions {
  /** Exact issuer and API audience, supplied by trusted host configuration. */
  issuer: string;
  audience: string;
  jwksUri: string;
  algorithms?: readonly OidcAlgorithm[];
  /** RFC 9068 access tokens by default; JWT requires a dedicated API audience. */
  tokenType?: 'at+jwt' | 'JWT';
  clockToleranceSeconds?: number;
  /** Trusted host transport, for service integration or isolated runtime tests. */
  fetchImpl?: typeof fetch;
}
export interface OidcPrincipal { issuer: string; subject: string }

const MAX_TOKEN_LENGTH = 8185; // Fits the collector's 8192-character Authorization limit.
const MAX_JWKS_BYTES = 65536;
const MAX_JWKS_KEYS = 32;
const TIMEOUT_MS = 5000;
const COOLDOWN_MS = 30000;

/** No credentials, discovery, or network activity at construction time. */
export function createOidcVerifier(options: OidcOptions): (bearer: string) => Promise<OidcPrincipal | null> {
  const issuer = httpsUrl(options.issuer, 'issuer');
  const jwksUri = httpsUrl(options.jwksUri, 'jwksUri');
  if (issuer.length > 512 || !options.audience?.trim() || options.audience.length > 512 || options.audience !== options.audience.trim())
    throw new TypeError('Invalid OIDC issuer or API audience configuration');
  const audience = options.audience;
  const algorithms = [...(options.algorithms ?? ['RS256'])];
  if (!algorithms.length || algorithms.some(alg => !['RS256', 'ES256'].includes(alg)) || new Set(algorithms).size !== algorithms.length)
    throw new TypeError('OIDC algorithms must be RS256 and/or ES256');
  const tokenType = options.tokenType ?? 'at+jwt';
  if (!['at+jwt', 'JWT'].includes(tokenType)) throw new TypeError('Invalid OIDC token type configuration');
  const tolerance = options.clockToleranceSeconds ?? 5;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 60)
    throw new TypeError('OIDC clock tolerance must be 0..60 seconds');
  const transport = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  let retryAfter = 0;
  const keys = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: TIMEOUT_MS, cooldownDuration: COOLDOWN_MS, cacheMaxAge: 600000,
    [customFetch]: async (url, init) => {
      if (Date.now() < retryAfter) throw new Error('OIDC key endpoint cooling down');
      try {
        const response = await transport(url, {
          ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        });
        if (response.status !== 200 || !response.body) {
          await response.body?.cancel();
          throw new Error('OIDC key endpoint unavailable');
        }
        const body = await boundedBody(response, init.signal);
        const jwks: unknown = JSON.parse(body);
        if (!jwks || typeof jwks !== 'object' || !('keys' in jwks) || !Array.isArray(jwks.keys) ||
          jwks.keys.length === 0 || jwks.keys.length > MAX_JWKS_KEYS || jwks.keys.some(key =>
            !key || typeof key !== 'object' || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => field in key)))
          throw new Error('Invalid public OIDC key set');
        return new Response(body, { headers: { 'Content-Type': 'application/jwk-set+json' } });
      } catch {
        retryAfter = Date.now() + COOLDOWN_MS;
        throw new Error('OIDC key endpoint unavailable');
      }
    },
  });

  return async bearer => {
    try {
      if (typeof bearer !== 'string' || !bearer || bearer.length > MAX_TOKEN_LENGTH) return null;
      const header = decodeProtectedHeader(bearer);
      if (!algorithms.includes(header.alg as OidcAlgorithm) || typeof header.kid !== 'string' ||
        !header.kid.trim() || header.kid.length > 256 || header.jku !== undefined || header.x5u !== undefined) return null;
      const { payload } = await jwtVerify(bearer, keys, {
        algorithms, issuer, audience, typ: tokenType, clockTolerance: tolerance,
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      });
      const now = Date.now() / 1000;
      if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 512 ||
        typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + tolerance ||
        typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) return null;
      return { issuer, subject: payload.sub };
    } catch {
      // Verification details, claims, and tokens never enter logs or error responses.
      return null;
    }
  };
}

function httpsUrl(value: string, field: string): string {
  try {
    const url = new URL(value);
    if (value !== value.trim() || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error();
    return value; // Keep issuer equality exact, including any trailing slash.
  } catch { throw new TypeError(`Invalid HTTPS OIDC ${field} configuration`); }
}

async function boundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_JWKS_BYTES)) {
    await response.body!.cancel();
    throw new Error('OIDC key set exceeds size limit');
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JWKS_BYTES) throw new Error('OIDC key set exceeds size limit');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
