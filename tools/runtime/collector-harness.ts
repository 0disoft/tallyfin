import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../../apps/collector/src/config.ts';

/** Local benchmark only: fresh database ID, ephemeral keys in memory, no external provider. */
export async function collectorHarness(directory: string, frozenNow?: number, workerCount = 1) {
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 4) throw Error('invalid-benchmark-worker-count');
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
      globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)});
      ${workerCount === 1 ? 'export default worker;' : `export default {
        async fetch(request, env, ctx) {
          const response = await worker.fetch(request, env, ctx), headers = new Headers(response.headers);
          headers.set('X-Tallyfin-Bench-Worker', env.BENCH_INSTANCE);
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }, scheduled(controller, env, ctx) { return worker.scheduled(controller, env, ctx); }
      };`}` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const databaseId = crypto.randomUUID();
  const bindings = { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: principal.issuer,
      OIDC_AUDIENCE: 'benchmark-admin', OIDC_JWKS_URI: `${principal.issuer}/jwks`,
      PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: principal.issuer,
      PUBLISHER_OIDC_AUDIENCE: 'benchmark-publisher', PUBLISHER_OIDC_JWKS_URI: `${principal.issuer}/jwks` };
  const collectorNames = Array.from({ length: workerCount }, (_, index) => `collector-${index}`);
  const options = { modules: true as const, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    d1Databases: { DB: databaseId }, bindings };
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, d1Persist: join(directory, 'state'),
    ...(workerCount === 1 ? options : { workers: [{ name: 'benchmark-router', modules: true, compatibilityDate: '2026-08-06',
      d1Databases: { DB: databaseId }, serviceBindings: Object.fromEntries(collectorNames.map((name, index) => [`W${index}`, name])),
      script: `export default { fetch(request, env) {
        const url = new URL(request.url), match = /^\\/worker\\/([0-3])(\\/.*)$/.exec(url.pathname);
        if (!match || !env['W' + match[1]]) return new Response(null, {status:404});
        url.pathname = match[2]; return env['W' + match[1]].fetch(new Request(url, request));
      } };` }, ...collectorNames.map(name => ({ ...options, name, bindings: { ...bindings, BENCH_INSTANCE: name } }))] }),
    log: new Log(LogLevel.NONE) });
  return { mf, principal, adminToken, publisherToken, now, collectorNames };
}
