import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { DEFAULT_SETTINGS } from '../../collector/src/config.ts';
import { migrationStatements, seed } from '../../../packages/storage-d1/test/helpers.ts';

test('admin edge routes through a real collector Worker and D1 without bypassing authentication or grants', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-admin-edge-'));
  let mf: Miniflare | undefined;
  try {
    // Runtime fixtures only: keys and HTML are ephemeral, never production configuration.
    await mkdir(join(directory, 'v1/projects'), { recursive: true });
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'index.html'), '<html><body>admin shell</body></html>');
    await writeFile(join(directory, 'v1/projects/index.html'), '<html>API path collision</html>');
    await writeFile(join(directory, 'assets/test.js'), 'console.log("static");');
    const issuer = 'https://identity.example.invalid'; const subject = crypto.randomUUID();
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral', alg: 'RS256' }] };
    const collector = await build({ stdin: { loader: 'ts', resolveDir: root, contents:
      `import worker from './apps/collector/src/runtime.ts'; globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)}); export default worker;` },
      bundle: true, external: ['cloudflare:workers'], write: false, platform: 'browser', format: 'esm', target: 'es2023' });
    mf = new Miniflare({ log: new Log(LogLevel.NONE), workers: [
      { name: 'test-admin', modules: true, script: await readFile(join(root, 'apps/admin/worker/index.js'), 'utf8'), compatibilityDate: '2026-08-06',
        serviceBindings: { COLLECTOR: 'test-collector' },
        assets: { directory, binding: 'ASSETS', routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/v1', '/v1/*'] } },
          assetConfig: { not_found_handling: 'none' } } },
      { name: 'test-collector', modules: true, script: collector.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
        bindings: { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: 'edge-test', OIDC_JWKS_URI: `${issuer}/jwks` },
        d1Databases: { DB: 'edge-test-db' } },
    ] });
    const db = await mf.getD1Database('DB', 'test-collector');
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await seed(db);
    await db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', issuer, subject, 'owner', Date.now()).run();
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' })
      .setIssuer(issuer).setAudience('edge-test').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const denied = await mf.dispatchFetch('https://admin.example.invalid/v1/projects', { headers: { Accept: 'text/html' } });
    assert.equal(denied.status, 401); assert.equal((await denied.json() as { error: { code: string } }).error.code, 'unauthorized');
    const response = await mf.dispatchFetch('https://admin.example.invalid/v1/projects', { headers: { Authorization: `Bearer ${token}`, Accept: 'text/html' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /Sembom/);
    await db.prepare('DELETE FROM project_grants').run();
    const revoked = await mf.dispatchFetch('https://admin.example.invalid/v1/projects/sembom/schemas/1', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(revoked.status, 403);
    for (const path of ['/v1', '/v1/', '/v1/not-an-endpoint']) {
      const missing = await mf.dispatchFetch('https://admin.example.invalid' + path, { headers: { Accept: 'text/html' } });
      assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type') ?? '', /json/);
    }
    for (const path of ['/', '/demo', '/auth/callback?error=access_denied', '/v10']) {
      const page = await mf.dispatchFetch('https://admin.example.invalid' + path, { headers: { Accept: 'text/html' } });
      assert.equal(page.status, 200); assert.match(await page.text(), /admin shell/);
    }
    assert.equal((await mf.dispatchFetch('https://admin.example.invalid/assets/test.js')).status, 200);
    assert.equal((await mf.dispatchFetch('https://admin.example.invalid/assets/missing.js', { headers: { Accept: 'text/html' } })).status, 404);
  } finally {
    await mf?.dispose();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
