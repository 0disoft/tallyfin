import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { hashPassword } from 'better-auth/crypto';
import { bootstrapSql } from '../src/bootstrap.ts';

test('Workers/D1 runtime signs in with native scrypt, closes signup and management routes, bounds bodies and preserves private metadata', async () => {
  const origin = 'https://auth.example.invalid', adminOrigin = 'https://admin.example.invalid';
  const bundle = await build({ entryPoints: [new URL('../src/runtime.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true, write: false, format: 'esm', platform: 'node', conditions: ['workerd'], target: 'es2023', external: ['node:*', 'cloudflare:workers'] });
  // Match the workerd build bundled with this checkout's locked Miniflare.
  const mf = new Miniflare({ modules: [{ type: 'ESModule', path: 'auth.mjs', contents: bundle.outputFiles[0]!.text }], compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'], d1Databases: ['AUTH_DB'], log: new Log(LogLevel.NONE),
    bindings: { AUTH_ORIGIN: origin, ADMIN_ORIGIN: adminOrigin, ADMIN_EMAIL: 'operator@example.invalid', BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID() } });
  try {
    const db = await mf.getD1Database('AUTH_DB');
    const migration = await readFile(new URL('../migrations/0001_auth.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    const password = crypto.randomUUID();
    const sql = bootstrapSql({ email: 'operator@example.invalid', subject: crypto.randomUUID(), passwordHash: await hashPassword(password), adminOrigin });
    await db.batch(sql.split(';').filter(part => part.trim()).map(part => db.prepare(part)));
    const call = (path: string, init?: RequestInit) => mf.dispatchFetch(origin + path, init);
    assert.equal((await call('/health')).status, 200);
    const loginHtml = await (await call('/sign-in')).text();
    assert.match(loginHtml, /관리자 로그인/);
    assert.doesNotMatch(loginHtml, /id="password"|비밀번호 변경/);
    const lockedPasswordPage = await call('/account/password', { redirect: 'manual' });
    assert.equal(lockedPasswordPage.status, 302);
    assert.equal(lockedPasswordPage.headers.get('Location'), '/sign-in?returnTo=password');
    assert.equal((await call('/api/auth/sign-up/email', { method: 'POST' })).status, 404);
    assert.equal((await call('/api/auth/oauth2/register', { method: 'POST' })).status, 404);
    assert.equal((await call('/api/auth/admin/list-users')).status, 404);
    assert.equal((await call('/api/auth/token')).status, 404);
    assert.equal((await call('/maintenance')).status, 401);
    assert.equal((await call('/maintenance', { method: 'POST', headers: { Origin: adminOrigin } })).status, 403);
    const metadata = await call('/api/auth/.well-known/openid-configuration', { headers: { Origin: adminOrigin } });
    assert.equal(metadata.status, 200); assert.equal(metadata.headers.get('Access-Control-Allow-Origin'), adminOrigin);
    const denied = await call('/api/auth/sign-in/email', { method: 'POST', headers: { Origin: 'https://attacker.example.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operator@example.invalid', password }) });
    assert.equal(denied.status, 403);
    const large = await call('/api/auth/sign-in/email', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(16385) });
    assert.equal(large.status, 413);
    const login = await call('/api/auth/sign-in/email', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.17' },
      body: JSON.stringify({ email: 'operator@example.invalid', password }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(login.headers.get('set-cookie')!, /Secure/);
    assert.match(login.headers.get('set-cookie')!, /SameSite=Lax/);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const accountPage = await call('/account/password', { headers: { Cookie: cookie } });
    assert.equal(accountPage.status, 200);
    const passwordHtml = await accountPage.text();
    assert.match(passwordHtml, /minlength="12"/);
    assert.match(passwordHtml, /name="confirmPassword"/);
    assert.match(passwordHtml, /data-admin-origin="https:\/\/admin.example.invalid"/);
    assert.equal(accountPage.headers.get('Cache-Control'), 'no-store');
    const session = await db.prepare('SELECT ipAddress,userAgent FROM session').first();
    assert.equal(session!.ipAddress, null); assert.equal(session!.userAgent, null);
    const keys = await db.prepare('SELECT key FROM rateLimit').all();
    assert.ok(keys.results.length > 0); assert.ok(keys.results.every(row => !String(row.key).includes('192.0.2.17')));
    await db.prepare('INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,?,?)').bind('expired', 'expired-pseudonym', 1, Date.now() - 2 * 86400000).run();
    const cleanup = await (await mf.getWorker()).scheduled({ cron: '17 * * * *' });
    assert.equal(cleanup.outcome, 'ok');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM rateLimit WHERE id=?').bind('expired').first())!.n, 0);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM rateLimit').first())!.n, keys.results.length);
  } finally { await mf.dispose(); }
});
