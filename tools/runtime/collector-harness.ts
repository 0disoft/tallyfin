import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../../apps/collector/src/config.ts';

/** Local benchmark only: fresh database ID, ephemeral keys in memory, no external provider. */
export async function collectorHarness(directory: string, frozenNow?: number) {
  const now = frozenNow ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw Error('invalid-benchmark-clock');
  const principal = { issuer: 'https://identity.example.invalid', subject: 'synthetic-benchmark-operator' };
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral-benchmark', alg: 'RS256' }] };
  const token = async (audience: string) => new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'ephemeral-benchmark', typ: 'at+jwt' })
    .setIssuer(principal.issuer).setSubject(principal.subject).setAudience(audience).setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 300).sign(privateKey);
  const adminToken = await token('benchmark-admin'), publisherToken = await token('benchmark-publisher');
  const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    contents: `import worker from './apps/collector/src/runtime.ts'; ${frozenNow === undefined ? '' : `Date.now = () => ${now};`}
      globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)}); export default worker;` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    host: '127.0.0.1', port: 0, d1Databases: { DB: crypto.randomUUID() }, d1Persist: join(directory, 'state'),
    bindings: { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: principal.issuer,
      OIDC_AUDIENCE: 'benchmark-admin', OIDC_JWKS_URI: `${principal.issuer}/jwks`,
      PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: principal.issuer,
      PUBLISHER_OIDC_AUDIENCE: 'benchmark-publisher', PUBLISHER_OIDC_JWKS_URI: `${principal.issuer}/jwks` },
    log: new Log(LogLevel.NONE) });
  return { mf, principal, adminToken, publisherToken, now };
}
