import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from 'jose';
import { awaitSignal, discard } from './lifecycle.ts';

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
  /** Machine ingestion requires this one audience only; administrator defaults remain compatible. */
  exclusiveAudience?: boolean;
  /** Trusted host transport, for service integration or isolated runtime tests. */
  fetchImpl?: typeof fetch;
  /** Epoch milliseconds for one consistent JWT claim evaluation. */
  now?: () => number;
  /** Elapsed milliseconds for the failure cooldown; independent of wall-clock changes. */
  monotonicNow?: () => number;
  /** Optional host deadline, combined with the key resolver's own five-second limit. */
  timeoutSignal?: (milliseconds: number) => AbortSignal;
}
export interface OidcPrincipal { issuer: string; subject: string }

const MAX_TOKEN_LENGTH = 8185; // Fits the collector's 8192-character Authorization limit.
const MAX_JWKS_BYTES = 65536;
const MAX_JWKS_KEYS = 32;
const TIMEOUT_MS = 5000;
const COOLDOWN_MS = 30000;

/** No credentials, discovery, or network activity at construction time. */
export function createOidcVerifier(options: OidcOptions): (bearer: string, options?: { signal?: AbortSignal }) => Promise<OidcPrincipal | null> {
  const issuer = httpsUrl(options.issuer, 'issuer');
  const jwksUri = httpsUrl(options.jwksUri, 'jwksUri');
  if (issuer.length > 512 || !options.audience?.trim() || options.audience.length > 512 || options.audience !== options.audience.trim())
    throw new TypeError('Invalid OIDC issuer or API audience configuration');
  const audience = options.audience;
  if (options.exclusiveAudience !== undefined && typeof options.exclusiveAudience !== 'boolean')
    throw new TypeError('Invalid audience policy configuration');
  const exclusiveAudience = options.exclusiveAudience ?? false;
  const algorithms = [...(options.algorithms ?? ['RS256'])];
  if (!algorithms.length || algorithms.some(alg => !['RS256', 'ES256'].includes(alg)) || new Set(algorithms).size !== algorithms.length)
    throw new TypeError('OIDC algorithms must be RS256 and/or ES256');
  const tokenType = options.tokenType ?? 'at+jwt';
  if (!['at+jwt', 'JWT'].includes(tokenType)) throw new TypeError('Invalid OIDC token type configuration');
  const tolerance = options.clockToleranceSeconds ?? 5;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 60)
    throw new TypeError('OIDC clock tolerance must be 0..60 seconds');
  const transport = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const clock = options.now ?? Date.now, elapsed = options.monotonicNow ?? (() => performance.now());
  let retryAfter = -Infinity;
  const keys = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: TIMEOUT_MS, cooldownDuration: COOLDOWN_MS, cacheMaxAge: 600000,
    [customFetch]: async (url, init) => {
      if (elapsed() < retryAfter) throw new Error('OIDC key endpoint cooling down');
      const signal = options.timeoutSignal ? AbortSignal.any([init.signal, options.timeoutSignal(TIMEOUT_MS)]) : init.signal;
      try {
        const response = await awaitSignal(signal, async () => {
          const value = await transport(url, {
            ...init, signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
          });
          if (signal.aborted) { discard(value.body); signal.throwIfAborted(); }
          return value;
        });
        if (response.status !== 200 || !response.body) {
          discard(response.body);
          throw new Error('OIDC key endpoint unavailable');
        }
        const body = await boundedBody(response, signal);
        const jwks: unknown = JSON.parse(body);
        if (!jwks || typeof jwks !== 'object' || !('keys' in jwks) || !Array.isArray(jwks.keys) ||
          jwks.keys.length === 0 || jwks.keys.length > MAX_JWKS_KEYS || jwks.keys.some(key =>
            !key || typeof key !== 'object' || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => field in key)))
          throw new Error('Invalid public OIDC key set');
        return new Response(body, { headers: { 'Content-Type': 'application/jwk-set+json' } });
      } catch {
        retryAfter = elapsed() + COOLDOWN_MS;
        throw new Error('OIDC key endpoint unavailable');
      }
    },
  });

  return async (bearer, call = {}) => {
    try {
      call.signal?.throwIfAborted();
      if (typeof bearer !== 'string' || !bearer || bearer.length > MAX_TOKEN_LENGTH) return null;
      const header = decodeProtectedHeader(bearer);
      if (!algorithms.includes(header.alg as OidcAlgorithm) || typeof header.kid !== 'string' ||
        !header.kid.trim() || header.kid.length > 256 || header.jku !== undefined || header.x5u !== undefined) return null;
      const at = clock();
      if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000) return null;
      const verify = () => jwtVerify(bearer, keys, {
        algorithms, issuer, audience, typ: tokenType, clockTolerance: tolerance, currentDate: new Date(at),
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      });
      const { payload } = await (call.signal ? awaitSignal(call.signal, verify) : verify());
      // Key acquisition may cross an expiry boundary. Never accept using only its start time.
      const finishedAt = clock();
      if (!Number.isSafeInteger(finishedAt) || finishedAt < 0 || finishedAt > 8640000000000000) return null;
      const now = finishedAt / 1000;
      if (exclusiveAudience && payload.aud !== audience &&
        !(Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === audience)) return null;
      if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 512 ||
        typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + tolerance ||
        typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= payload.iat ||
        payload.exp <= Math.floor(now) - tolerance || (payload.nbf !== undefined && payload.nbf > Math.floor(now) + tolerance)) return null;
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
    discard(response.body);
    throw new Error('OIDC key set exceeds size limit');
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { try { void reader.cancel().catch(() => {}); } catch { /* Best effort. */ } };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await awaitSignal(signal, () => reader.read());
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
    abort();
    reader.releaseLock();
  }
}
