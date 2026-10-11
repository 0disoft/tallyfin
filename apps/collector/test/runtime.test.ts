import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { runCli } from '../../../tools/provision/cli.ts';
import { startLocal } from '../../../tools/runtime/local.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import { example, migrationStatements, seed } from '../../../packages/storage-d1/test/helpers.ts';

test('configured runtime verifies OIDC bindings and runs scheduled cleanup against its bound DB', async () => {
  const issuer = 'https://identity.example.invalid';
  const subject = crypto.randomUUID();
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral', alg: 'RS256' }] };
  const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
    contents: `import worker from './apps/collector/src/runtime.ts';
      globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)}); export default worker;` },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
    bindings: { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: 'runtime-test', OIDC_JWKS_URI: `${issuer}/jwks` },
    d1Databases: { DB: 'runtime-test' }, log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB');
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await seed(db);
    await db.prepare('INSERT INTO project_grants VALUES (?,?,?,?,?)').bind('sembom', issuer, subject, 'owner', Date.now()).run();
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' })
      .setIssuer(issuer).setAudience('runtime-test').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    assert.equal((await mf.dispatchFetch('https://runtime.example.invalid/v1/projects')).status, 401);
    assert.equal((await mf.dispatchFetch('https://runtime.example.invalid/v1/projects', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await db.prepare('DELETE FROM project_grants').run();
    const identity = await mf.dispatchFetch('https://runtime.example.invalid/v1/identity', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(identity.status, 200); assert.deepEqual(await identity.json(), { issuer, subject });
    assert.equal((await mf.dispatchFetch('https://runtime.example.invalid/v1/identity', { headers: { Authorization: `Bearer ${token}x` } })).status, 401);
    const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' })
      .setIssuer(issuer).setAudience('publisher-audience').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    assert.equal((await mf.dispatchFetch('https://runtime.example.invalid/v1/identity', { headers: { Authorization: `Bearer ${wrongAudience}` } })).status, 401);
    const health = await mf.dispatchFetch('https://runtime.example.invalid/v1/health', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok', scope: 'administrator_storage_read' });
    assert.equal(health.headers.get('Cache-Control'), 'no-store'); assert.equal(health.headers.get('Vary'), 'Authorization');
    assert.equal((await mf.dispatchFetch('https://runtime.example.invalid/v1/health')).status, 401);
    assert.equal((await mf.dispatchFetch('https://runtime.example.invalid/v1/health', { headers: { Authorization: `Bearer ${wrongAudience}` } })).status, 401);
    const denied = await mf.dispatchFetch('https://runtime.example.invalid/v1/projects/sembom/schemas/1', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(denied.status, 403);
    assert.equal((await (await mf.getWorker()).scheduled({ scheduledTime: Date.now(), cron: '* * * * *' })).outcome, 'ok');
    await db.prepare('DROP TABLE project_grants').run();
    const unavailable = await mf.dispatchFetch('https://runtime.example.invalid/v1/health', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('Retry-After'), '1');
    assert.equal((await unavailable.json() as { error: { code: string } }).error.code, 'storage_unavailable');
  } finally { await mf.dispose(); }
});

test('local collector reads provisioned persistent data, defaults to closed auth and releases its listener', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallyfin-runtime-'));
  const state = join(directory, 'state'); const file = join(directory, 'registry.json');
  let local: Awaited<ReturnType<typeof startLocal>> | undefined;
  try {
    await writeFile(file, JSON.stringify(example('registry')));
    const flags = ['--local', '--state-dir', state];
    await runCli(['init', ...flags, '--apply'], () => {});
    await runCli(['register', ...flags, '--file', file, '--apply'], () => {});
    local = await startLocal(state, DEFAULT_SETTINGS, 0);
    assert.equal(await local.db.prepare('SELECT name FROM projects WHERE id=?').bind('sembom').first('name'), 'Sembom');
    assert.equal((await fetch(new URL('/v1/projects', local.url))).status, 401);
    await local.cleanup();
    assert.equal(await local.db.prepare('SELECT revision FROM retention_cleanup_state').first('revision'), 1);
    const url = local.url; await local.close(); local = undefined;
    await assert.rejects(fetch(url));
    await assert.rejects(startLocal(join(directory, 'uninitialized'), DEFAULT_SETTINGS, 0), /Initialize the local DB/);
  } finally {
    await local?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
