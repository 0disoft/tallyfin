import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { BrowserLogin, LoginError, TRANSACTION_KEY } from './client.ts';
import { loginConfig } from './config.ts';
import { captureCallback } from './bootstrap.ts';

const issuer = 'https://identity.example.invalid';
const config = loginConfig({ VITE_OIDC_ISSUER: issuer, VITE_OIDC_CLIENT_ID: 'test-public-client', VITE_OIDC_SCOPE: 'openid api:read offline_access' }, 'https://admin.example.invalid');
let key;
let jwk;
before(async () => { key = await generateKeyPair('RS256'); jwk = { ...await exportJWK(key.publicKey), kid: 'test-key', alg: 'RS256' }; });

function fixture(options = {}) {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const calls = [];
  const codes = new Map();
  let refresh = crypto.randomUUID();
  let refreshCalls = 0;
  let idNonce;
  const mint = async claims => new SignJWT({ ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer).setAudience(config.clientId).setSubject('test-admin').setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
  const fetchImpl = async (input, init) => {
    calls.push({ input: String(input), init });
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer,
      authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
      code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'], ...options.metadata });
    if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    assert.equal(url, `${issuer}/token`);
    const body = new URLSearchParams(init.body);
    assert.equal(body.has('client_secret'), false);
    if (body.get('grant_type') === 'refresh_token') {
      refreshCalls++;
      assert.equal(body.get('refresh_token'), refresh);
      if (options.refreshError) return Response.json({ error: 'invalid_grant', error_description: 'private detail' }, { status: 400 });
      if (options.refreshWait) await options.refreshWait(init.signal);
      if (!options.noRotation) refresh = crypto.randomUUID();
      return Response.json({ access_token: await mint({}), token_type: 'Bearer', expires_in: 300, refresh_token: refresh,
        ...(options.changedSubject ? { id_token: await mint({ sub: 'different-user' }) } : {}) });
    }
    const request = codes.get(body.get('code'));
    assert.ok(request, 'only this fixture may issue an authorization code');
    codes.delete(body.get('code'));
    assert.equal(body.get('code_verifier'), request.verifier);
    assert.equal(body.get('redirect_uri'), config.redirectUri);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.verifier));
    assert.equal(Buffer.from(digest).toString('base64url'), request.challenge);
    idNonce = request.nonce;
    const id = await mint({ nonce: options.badNonce ? 'different' : idNonce });
    return Response.json({ access_token: await mint({}), token_type: 'Bearer', expires_in: options.ttl ?? 300,
      id_token: options.badSignature ? id.slice(0, -8) + 'tampered' : id,
      ...(options.noRefresh ? {} : { refresh_token: refresh }) });
  };
  const login = new BrowserLogin(config, storage, fetchImpl);
  const start = async () => {
    const url = new URL(await login.begin());
    const tx = JSON.parse(data.get(TRANSACTION_KEY));
    const code = crypto.randomUUID();
    codes.set(code, { ...tx, challenge: url.searchParams.get('code_challenge') });
    const callback = new URL(config.redirectUri);
    callback.searchParams.set('code', code); callback.searchParams.set('state', tx.state);
    return { url, callback, tx };
  };
  return { login, data, calls, start, get refreshCalls() { return refreshCalls; } };
}

test('PKCE redirect binds state/nonce and callback exchanges only once with real ID signature validation', async () => {
  const f = fixture();
  const { url, callback } = await f.start();
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.has('code_verifier'), false);
  await Promise.all([f.login.complete(callback), f.login.complete(callback)]);
  assert.equal(f.data.size, 0);
  const token = await f.login.getAccessToken();
  assert.ok(token.length > 0);
  assert.equal(JSON.stringify(f.login).includes(token), false);
  assert.equal(f.calls.filter(c => c.input.endsWith('/token')).length, 1);
  for (const { init } of f.calls) { assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.redirect, 'error'); }
  f.login.destroy();
  await assert.rejects(f.login.getAccessToken(), LoginError);
});

test('invalid state, duplicate code, expired/missing transaction, wrong path and error callback never exchange tokens', async () => {
  for (const kind of ['state', 'duplicate', 'expired', 'missing', 'path', 'error', 'configuration']) {
    const f = fixture(); const { callback, tx } = await f.start();
    if (kind === 'state') callback.searchParams.set('state', 'wrong');
    if (kind === 'duplicate') callback.searchParams.append('code', 'another');
    if (kind === 'expired') f.data.set(TRANSACTION_KEY, JSON.stringify({ ...tx, createdAt: Date.now() - 600001 }));
    if (kind === 'missing') f.data.clear();
    if (kind === 'path') callback.pathname = '/other';
    if (kind === 'error') { callback.searchParams.delete('code'); callback.searchParams.set('error', 'access_denied'); }
    if (kind === 'configuration') f.data.set(TRANSACTION_KEY, JSON.stringify({ ...tx, config: 'other' }));
    await assert.rejects(f.login.complete(callback), LoginError);
    assert.equal(f.data.size, 0);
    assert.equal(f.calls.filter(c => c.input.endsWith('/token')).length, 0);
    f.login.destroy();
  }
});

test('wrong nonce or forged ID signature cannot establish a session', async () => {
  for (const options of [{ badNonce: true }, { badSignature: true }]) {
    const f = fixture(options); const { callback } = await f.start();
    await assert.rejects(f.login.complete(callback), LoginError);
    await assert.rejects(f.login.getAccessToken(), LoginError);
    f.login.destroy();
  }
});

test('concurrent API requests perform one rotating refresh and use the new access token', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = fixture(); const { callback } = await f.start(); await f.login.complete(callback);
  const previous = await f.login.getAccessToken();
  t.mock.timers.tick(271000);
  const next = await Promise.all([f.login.getAccessToken(), f.login.getAccessToken(), f.login.getAccessToken()]);
  assert.equal(f.refreshCalls, 1); assert.ok(next.every(token => token === next[0])); assert.notEqual(next[0], previous);
  f.login.destroy();
});

test('failed or non-rotating refresh clears session and is never replayed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  for (const options of [{ refreshError: true }, { noRotation: true }]) {
    const f = fixture(options); const { callback } = await f.start(); await f.login.complete(callback);
    t.mock.timers.tick(271000);
    await assert.rejects(f.login.getAccessToken(), LoginError);
    await assert.rejects(f.login.getAccessToken(), LoginError);
    assert.equal(f.refreshCalls, 1); f.login.destroy();
  }
});

test('destroy during refresh aborts work and a late response cannot restore tokens', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture({ refreshWait: async signal => { assert.equal(signal.aborted, false); await waiting; } });
  const { callback } = await f.start(); await f.login.complete(callback);
  t.mock.timers.tick(271000);
  const pending = f.login.getAccessToken();
  await new Promise(resolve => setImmediate(resolve));
  f.login.destroy(); release();
  await assert.rejects(pending, LoginError);
  await assert.rejects(f.login.getAccessToken(), LoginError);
});

test('without a refresh token an expired session requires a new login', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = fixture({ noRefresh: true }); const { callback } = await f.start(); await f.login.complete(callback);
  t.mock.timers.tick(301000); await assert.rejects(f.login.getAccessToken(), LoginError);
  assert.equal(f.refreshCalls, 0); f.login.destroy();
});

test('unsafe metadata and non-PKCE providers are rejected before redirect or storage', async () => {
  for (const metadata of [{ issuer: 'https://other.example.invalid' }, { token_endpoint: 'http://identity.example.invalid/token' }, { code_challenge_methods_supported: [] }]) {
    const f = fixture({ metadata }); await assert.rejects(f.login.begin(), LoginError);
    assert.equal(f.data.size, 0); f.login.destroy();
  }
});

test('callback parameters are scrubbed synchronously and config contains no secret settings', () => {
  let clean;
  const url = captureCallback(`${config.redirectUri}?code=one-use&state=transaction#error`, path => { clean = path; });
  assert.equal(clean, '/auth/callback'); assert.equal(url.searchParams.get('code'), 'one-use');
  assert.equal(loginConfig({}, 'https://admin.example.invalid'), null);
  assert.throws(() => loginConfig({ VITE_OIDC_ISSUER: issuer }, 'https://admin.example.invalid'));
  assert.throws(() => loginConfig({ VITE_OIDC_ISSUER: issuer, VITE_OIDC_CLIENT_ID: 'client', VITE_OIDC_SCOPE: 'openid' }, 'http://remote.example.invalid'));
  assert.equal(loginConfig({ VITE_OIDC_ISSUER: issuer, VITE_OIDC_CLIENT_ID: 'client', VITE_OIDC_SCOPE: 'openid' }, 'http://127.0.0.1:5180').redirectUri, 'http://127.0.0.1:5180/auth/callback');
});

test('oversized discovery rejects even when response cleanup never settles', { timeout: 1000 }, async () => {
  let cancelled = 0;
  const login = new BrowserLogin(config, { getItem() { return null; }, setItem() {}, removeItem() {} }, async () =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled++; return new Promise(() => {}); } })));
  try { await assert.rejects(login.begin(), LoginError); assert.equal(cancelled, 1); }
  finally { login.destroy(); }
});

test('destroy stops an uncooperative discovery and discards its late response', { timeout: 1000 }, async () => {
  let enter, finish, cancelled = 0;
  const ready = new Promise(resolve => { enter = resolve; });
  const login = new BrowserLogin(config, { getItem() { return null; }, setItem() {}, removeItem() {} }, async () => {
    enter(); return new Promise(resolve => { finish = resolve; });
  });
  const pending = login.begin(); await ready; login.destroy();
  await assert.rejects(pending, LoginError);
  finish(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('login errors retain the transport cause without serializing it', async () => {
  const cause = new Error('private provider detail');
  const login = new BrowserLogin(config, { getItem() { return null; }, setItem() {}, removeItem() {} }, async () => { throw cause; });
  try { await assert.rejects(login.begin(), error => {
    assert.equal(error.cause.cause, cause);
    assert.equal(JSON.stringify(error).includes(cause.message), false); return true;
  }); } finally { login.destroy(); }
});
