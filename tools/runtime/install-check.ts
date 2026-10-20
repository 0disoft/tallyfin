import { fileURLToPath, pathToFileURL } from 'node:url';
import * as oauth from 'oauth4webapi';
import { importJWK } from 'jose';
import { secureEndpoint } from '../../apps/admin/src/auth/config.ts';
import { awaitRequest } from '../../apps/admin/src/api/request-lifecycle.ts';
import { preparedInstallation } from './prepared-installation.ts';
import type { installation } from './installation.ts';

type Plan = ReturnType<typeof installation>;
type Check = { id: string; status: 'pass' | 'fail' | 'unknown'; required: boolean; code: string };
const PRIVATE_KEY_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
const MAX_BYTES = 65536;
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }

async function bounded(response: Response, signal: AbortSignal) {
  if (response.status !== 200 || !response.body) { discard(response); throw Error(); }
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) { discard(response); throw Error(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await awaitRequest(signal, () => reader.read()); if (part.done) break;
      size += part.value.byteLength; if (size > MAX_BYTES) throw Error(); chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function browserAllowed(response: Response, origin: string, endpoint: string) {
  if (new URL(endpoint).origin === origin) return true;
  const allowed = response.headers.get('Access-Control-Allow-Origin');
  return allowed === '*' || allowed === origin;
}
const supports = (value: unknown, item: string) => Array.isArray(value) && value.every(entry => typeof entry === 'string') && value.includes(item);
async function compatibleKeys(value: unknown, algorithms: string[]) {
  if (!value || typeof value !== 'object' || !('keys' in value) || !Array.isArray(value.keys) ||
    value.keys.length < 1 || value.keys.length > 32 || value.keys.some(key => !key || typeof key !== 'object' ||
      PRIVATE_KEY_FIELDS.some(field => field in key))) return false;
  for (const algorithm of algorithms) {
    let supported = false;
    for (const key of value.keys) {
      if (typeof key.kid !== 'string' || !key.kid.trim() || key.kid.length > 256 ||
        (key.alg !== undefined && key.alg !== algorithm) || (key.use !== undefined && key.use !== 'sig') ||
        (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify'))) ||
        (algorithm === 'RS256' ? key.kty !== 'RSA' : key.kty !== 'EC' || key.crv !== 'P-256')) continue;
      try {
        const imported = await importJWK(key, algorithm);
        if (algorithm === 'RS256' && (!(imported instanceof CryptoKey) || (imported.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048)) continue;
        supported = true; break;
      } catch { /* Invalid public key is not evidence of compatibility. */ }
    }
    // One configured algorithm is sufficient to verify a token. This does not prove actual issuance.
    if (supported) return true;
  }
  return false;
}

/** Public metadata only. Does not log in, request tokens, contact Cloudflare or change any resource. */
export async function checkInstallationProvider(plan: Plan, fetchImpl: typeof fetch = fetch,
  signal: AbortSignal = new AbortController().signal) {
  signal.throwIfAborted();
  const checks: Check[] = [];
  const add = (id: string, status: Check['status'], code: string, required = true) => { checks.push({ id, status, required, code }); };
  const origin = plan.registration.browserOrigin;
  const request: typeof fetch = async (input, init) => {
    const endpoint = String(input); secureEndpoint(endpoint);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000), ...(init?.signal ? [init.signal] : [])]);
    deadline.throwIfAborted();
    const response = await awaitRequest(deadline, async () => {
      const value = await fetchImpl(endpoint, { method: init?.method ?? 'GET', ...(init?.headers === undefined ? {} : { headers: init.headers }),
        signal: deadline, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (deadline.aborted) { discard(value); deadline.throwIfAborted(); }
      return value;
    });
    // Do not consume OPTIONS bodies. This probe sends no authorization code/client secret/token.
    if (init?.method === 'OPTIONS') { discard(response); return response; }
    return new Response(await bounded(response, deadline), { status: response.status, headers: response.headers });
  };
  const jwks = async (id: string, url: string, algorithms: string[], browser: boolean) => {
    try {
      const response = await request(url, { headers: browser && new URL(url).origin !== origin ? { Origin: origin } : {} });
      const keys: unknown = await response.json();
      add(id, await compatibleKeys(keys, algorithms) ? 'pass' : 'fail', 'public-signing-key-compatibility');
      if (browser) add('browser-jwks-cors', browserAllowed(response, origin, url) ? 'pass' : 'fail', 'observed-get-cors');
    } catch { add(id, 'unknown', 'public-key-response-unverified'); }
  };
  let metadata: oauth.AuthorizationServer | undefined;
  try {
    const response = await oauth.discoveryRequest(new URL(plan.registration.issuer),
      { signal, [oauth.customFetch]: input => request(input, { headers: new URL(String(input)).origin === origin ? {} : { Origin: origin } }) });
    metadata = await oauth.processDiscoveryResponse(new URL(plan.registration.issuer), response.clone());
    add('discovery-issuer', 'pass', 'exact-issuer-match');
    add('discovery-cors', browserAllowed(response, origin, plan.registration.issuer) ? 'pass' : 'fail', 'observed-get-cors');
  } catch { add('discovery-issuer', 'unknown', 'discovery-response-unverified'); }
  if (metadata) {
    let endpointsValid = true;
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
      try { if (typeof endpoint !== 'string') throw Error(); secureEndpoint(endpoint); } catch { endpointsValid = false; }
    }
    add('discovery-endpoints', endpointsValid ? 'pass' : 'fail', 'https-endpoints-required');
    add('pkce-s256', supports(metadata.code_challenge_methods_supported, 'S256') ? 'pass' : 'fail', 'advertised-s256-required');
    add('code-response', supports(metadata.response_types_supported, 'code') ? 'pass' : 'fail', 'advertised-code-required');
    add('id-token-algorithm', supports(metadata.id_token_signing_alg_values_supported, plan.registration.idTokenAlgorithm) ? 'pass' : 'fail', 'advertised-id-token-algorithm');
    const grants = metadata.grant_types_supported;
    add('code-grant', grants === undefined || supports(grants, 'authorization_code') ? 'pass' : 'fail', 'authorization-code-grant');
    // Discovery describes provider capabilities; it cannot establish a particular client's registration.
    add('public-client-registration', 'unknown', 'requires-provider-client-registration', false);
    if (endpointsValid) {
      await jwks('id-token-public-keys', metadata.jwks_uri!, [plan.registration.idTokenAlgorithm], true);
      if (new URL(metadata.token_endpoint!).origin === origin) add('token-cors-probe', 'pass', 'same-origin-token-endpoint', false);
      else {
        try {
          const response = await request(metadata.token_endpoint!, { method: 'OPTIONS', headers: {
            Origin: origin, 'Access-Control-Request-Method': 'POST' } });
          const methods = (response.headers.get('Access-Control-Allow-Methods') ?? '').split(',').map(value => value.trim());
          add('token-cors-probe', response.ok && browserAllowed(response, origin, metadata.token_endpoint!) && (methods.includes('POST') || methods.includes('*')) ? 'pass' : 'unknown',
            'options-only-not-token-exchange', false);
        } catch { add('token-cors-probe', 'unknown', 'options-response-unverified', false); }
      }
    }
  }
  await jwks('collector-admin-public-keys', plan.collector.vars.OIDC_JWKS_URI,
    plan.collector.vars.OIDC_ALGORITHMS.split(','), false);
  if (plan.collector.vars.PUBLISHER_AUTH_MODE === 'oidc') await jwks('collector-publisher-public-keys',
    plan.collector.vars.PUBLISHER_OIDC_JWKS_URI, plan.collector.vars.PUBLISHER_OIDC_ALGORITHMS.split(','), false);
  signal.throwIfAborted();
  return { schemaVersion: 'tallyfin.install-check/v1', checkedAt: new Date().toISOString(),
    publicChecksPassed: checks.filter(check => check.required).every(check => check.status === 'pass'),
    operationalReadinessVerified: false, remoteChanges: false, tokensRequested: false,
    checks, manualRequired: ['client-callback-and-origin-registration', 'actual-login-and-token-renewal',
      'access-token-audience-and-type-issuance', 'remote-worker-d1-and-cron', 'initial-administrator-permissions'] };
}
export async function runInstallCheckCli(argv: string[], write = (line: string) => process.stdout.write(`${line}\n`), fetchImpl?: typeof fetch) {
  if (argv.length === 1 && argv[0] === '--help') {
    write('npm run install:check -- --dir <prepared-installation>\nRevalidates the installation and reads public OIDC discovery/JWKS with a diagnostic token-endpoint OPTIONS probe. No login, token request, Cloudflare call, file write or remote mutation. Public checks do not prove operational readiness.'); return true;
  }
  if (argv.length !== 2 || argv[0] !== '--dir' || !argv[1] || argv[1].startsWith('--')) throw Error('invalid-install-check-arguments');
  const plan = await preparedInstallation(argv[1], fileURLToPath(new URL('../../', import.meta.url)));
  const result = await checkInstallationProvider(plan, fetchImpl, AbortSignal.timeout(45000));
  write(JSON.stringify(result)); return result.publicChecksPassed;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInstallCheckCli(process.argv.slice(2)).then(passed => { if (!passed) process.exitCode = 1; })
    .catch(() => { console.error(JSON.stringify({ code: 'installation_check_failed', message: 'Use --help and an unchanged prepared installation. Public provider checks could not be completed.' })); process.exitCode = 1; });
}
