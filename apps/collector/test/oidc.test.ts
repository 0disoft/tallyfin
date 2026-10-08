import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements, seed } from '../../../packages/storage-d1/test/helpers.ts';

test('OIDC Worker verifies real signatures before applying and rechecking D1 grants', async () => {
  const issuer = 'https://identity.example.invalid';
  const audience = 'tallyfin-test-api';
  // Fresh test-only private key stays in this process and is never serialized or logged.
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral', alg: 'RS256' }] };
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { createOidcWorker } from './apps/collector/src/index.ts';
    export default createOidcWorker({ issuer: ${JSON.stringify(issuer)}, audience: ${JSON.stringify(audience)},
      jwksUri: ${JSON.stringify(`${issuer}/jwks`)}, fetchImpl: async () => Response.json(${JSON.stringify(jwks)}) });
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    d1Databases: { DB: 'tallyfin-oidc-runtime-test' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await runtime.getD1Database('DB');
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await seed(db);
    await db.prepare('INSERT INTO project_grants (project_id,issuer,subject,role,created_at) VALUES (?,?,?,?,?)')
      .bind('sembom', issuer, 'ephemeral-admin', 'reader', Date.now()).run();
    const sign = (aud: string) => new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' })
      .setIssuer(issuer).setAudience(aud).setSubject('ephemeral-admin').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const get = (token: string) => runtime.dispatchFetch('https://collector.example.invalid/v1/projects/sembom/schemas/1',
      { headers: { Authorization: `Bearer ${token}` } });
    const valid = await sign(audience);
    assert.equal((await get(valid)).status, 200);
    assert.equal((await get(await sign('browser-client-id'))).status, 401);
    assert.equal((await get(valid.slice(0, -8) + 'tampered')).status, 401);
    await db.prepare('DELETE FROM project_grants').run();
    assert.equal((await get(valid)).status, 403);
  } finally { await runtime.dispose(); }
});
