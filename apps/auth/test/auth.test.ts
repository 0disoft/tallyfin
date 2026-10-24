import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { hashPassword } from 'better-auth/crypto';
import { decodeProtectedHeader } from 'jose';
import { createAuth, ADMIN_CLIENT_ID } from '../src/auth.ts';
import { bootstrapSql } from '../src/bootstrap.ts';
import { createOidcVerifier } from '../../../packages/auth-oidc/src/index.ts';

const origin = 'https://auth.example.invalid', adminOrigin = 'https://admin.example.invalid';
const secret = crypto.randomUUID() + crypto.randomUUID();
async function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(new URL('../migrations/0001_auth.sql', import.meta.url), 'utf8'));
  const subject = crypto.randomUUID(), password = crypto.randomUUID();
  database.exec(bootstrapSql({ email: 'operator@example.invalid', subject, passwordHash: await hashPassword(password), adminOrigin }));
  const auth = createAuth({ database, origin, adminOrigin, secret, adminEmail: 'operator@example.invalid' });
  const call = (path: string, init: RequestInit = {}) => auth.handler(new Request(origin + '/api/auth' + path, init));
  return { database, subject, password, auth, call };
}

test('closed signup and idempotent bootstrap preserve the initial credential and fixed PKCE client', async () => {
  const f = await fixture();
  try {
    const count = f.database.prepare('SELECT count(*) AS n FROM "user"').get()!;
    const response = await f.call('/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: 'stranger@example.invalid', password: crypto.randomUUID(), name: 'Stranger' }) });
    assert.ok(response.status >= 400);
    assert.deepEqual(f.database.prepare('SELECT count(*) AS n FROM "user"').get(), count);
    const before = f.database.prepare('SELECT password FROM account').get();
    f.database.exec(bootstrapSql({ email: 'other@example.invalid', subject: crypto.randomUUID(), passwordHash: await hashPassword(crypto.randomUUID()), adminOrigin }));
    assert.deepEqual(f.database.prepare('SELECT password FROM account').get(), before);
    assert.equal(f.database.prepare('SELECT requirePKCE FROM oauthClient').get()!.requirePKCE, 1);
  } finally { f.database.close(); }
});

test('real Better Auth PKCE code exchange produces a token accepted by the existing Collector verifier', async () => {
  const f = await fixture();
  try {
    const metadata = await (await f.call('/.well-known/openid-configuration')).json() as Record<string, string>;
    assert.equal(metadata.issuer, origin + '/api/auth');
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    const params = new URLSearchParams({ client_id: ADMIN_CLIENT_ID, redirect_uri: adminOrigin + '/auth/callback', response_type: 'code',
      scope: 'openid profile offline_access', state: crypto.randomUUID(), nonce: crypto.randomUUID(),
      code_challenge: challenge, code_challenge_method: 'S256', resource: adminOrigin + '/v1' });
    const authorize = await f.call('/oauth2/authorize?' + params);
    assert.equal(authorize.status, 302);
    const login = new URL(authorize.headers.get('Location')!, origin);
    const signedIn = await f.call('/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': '127.0.0.1' },
      body: JSON.stringify({ email: 'operator@example.invalid', password: f.password, oauth_query: login.search.slice(1), rememberMe: false }) });
    assert.equal(signedIn.status, 200);
    const result = await signedIn.json() as { redirect: boolean; url: string };
    assert.equal(result.redirect, true);
    const callback = new URL(result.url);
    assert.equal(callback.origin, adminOrigin);
    assert.equal(callback.searchParams.get('state'), params.get('state'));
    const code = callback.searchParams.get('code'); assert.ok(code);
    const exchange = new URLSearchParams({ grant_type: 'authorization_code', client_id: ADMIN_CLIENT_ID, code,
      redirect_uri: adminOrigin + '/auth/callback', code_verifier: verifier, resource: adminOrigin + '/v1' });
    const response = await f.call('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: exchange });
    assert.equal(response.status, 200);
    const tokens = await response.json() as { access_token: string; id_token: string; refresh_token: string };
    assert.equal(decodeProtectedHeader(tokens.access_token).alg, 'ES256');
    assert.equal(decodeProtectedHeader(tokens.access_token).typ, 'at+jwt');
    assert.ok(tokens.refresh_token); assert.ok(tokens.id_token);
    const verify = createOidcVerifier({ issuer: metadata.issuer!, audience: adminOrigin + '/v1', jwksUri: metadata.jwks_uri!, algorithms: ['ES256'],
      fetchImpl: async (url) => f.auth.handler(new Request(String(url))) });
    assert.deepEqual(await verify(tokens.access_token), { issuer: origin + '/api/auth', subject: f.subject });
    const refresh = await f.call('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ADMIN_CLIENT_ID, refresh_token: tokens.refresh_token, resource: adminOrigin + '/v1' }) });
    assert.equal(refresh.status, 200);
    const rotated = await refresh.json() as typeof tokens;
    assert.ok(rotated.refresh_token); assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.deepEqual(await verify(rotated.access_token), { issuer: origin + '/api/auth', subject: f.subject });
    const replay = await f.call('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: exchange });
    assert.equal(replay.status, 400);
    const session = f.database.prepare('SELECT ipAddress,userAgent FROM session').get()!;
    assert.equal(session.ipAddress, null); assert.equal(session.userAgent, null);
  } finally { f.database.close(); }
});

test('even a privately inserted second account cannot open an administrator session', async () => {
  const f = await fixture();
  try {
    f.database.prepare('UPDATE "user" SET email = ?').run('second@example.invalid');
    const response = await f.call('/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: 'second@example.invalid', password: f.password }) });
    assert.ok(response.status >= 400);
    assert.equal(f.database.prepare('SELECT count(*) AS n FROM session').get()!.n, 0);
  } finally { f.database.close(); }
});
