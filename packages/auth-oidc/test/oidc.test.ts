import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createOidcVerifier } from '../src/index.ts';
import type { OidcOptions } from '../src/index.ts';

// Real signatures under ephemeral keys. No reusable credentials or private keys are stored.
const issuer = 'https://identity.example.invalid';
const audience = 'tallyfin-test-api';
const config = { issuer, audience, jwksUri: `${issuer}/jwks`, clockToleranceSeconds: 0 };
let rsa: Awaited<ReturnType<typeof generateKeyPair>>;
let second: Awaited<ReturnType<typeof generateKeyPair>>;
let ec: Awaited<ReturnType<typeof generateKeyPair>>;
let rsaJwk: Awaited<ReturnType<typeof exportJWK>>;
before(async () => {
  [rsa, second, ec] = await Promise.all([generateKeyPair('RS256'), generateKeyPair('RS256'), generateKeyPair('ES256')]);
  rsaJwk = { ...await exportJWK(rsa.publicKey), kid: 'primary', alg: 'RS256', use: 'sig' };
});
async function signed(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = rsa.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: audience, sub: 'test-admin', iat: now, exp: now + 300, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'primary', typ: 'at+jwt', ...header }).sign(key);
}
function fixture(options: Partial<OidcOptions> = {}) {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const verify = createOidcVerifier({ ...config, fetchImpl: async (input, init) => {
    calls.push({ input, ...(init ? { init } : {}) });
    return Response.json({ keys: [rsaJwk] });
  }, ...options });
  return { verify, calls };
}

test('valid RSA access token returns only the verified identity and reuses public keys', async () => {
  const { verify, calls } = fixture();
  assert.equal(calls.length, 0);
  const token = await signed({ email: 'not-returned@example.invalid', role: 'owner' });
  assert.deepEqual(await verify(token), { issuer, subject: 'test-admin' });
  assert.deepEqual(await verify(token), { issuer, subject: 'test-admin' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input, config.jwksUri);
  assert.equal(calls[0]!.init!.redirect, 'error');
  assert.equal(calls[0]!.init!.credentials, 'omit');
  assert.equal(calls[0]!.init!.referrerPolicy, 'no-referrer');
  assert.equal(new Headers(calls[0]!.init!.headers).has('Authorization'), false);
});

test('bad signature, issuer, API audience, time claims and missing claims are rejected', async () => {
  const { verify } = fixture();
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { iss: 'https://other.example.invalid' }, { aud: 'browser-client-id' }, { exp: now - 1 },
    { nbf: now + 100 }, { iat: now + 100 }, { exp: now }, { sub: '' }, { sub: ' ' },
    { sub: 'x'.repeat(513) }, { exp: undefined }, { iat: undefined }, { aud: undefined }, { iss: undefined },
  ]) assert.equal(await verify(await signed(claims)), null);
  assert.equal(await verify(await signed({}, {}, second.privateKey)), null);
  assert.equal(await verify(await signed({}, { typ: 'JWT' })), null);
  assert.deepEqual(await verify(await signed({ aud: ['other', audience] })), { issuer, subject: 'test-admin' });
});

test('exclusive machine audience accepts only one intended audience while administrator compatibility stays unchanged', async () => {
  const { verify } = fixture({ exclusiveAudience: true });
  assert.deepEqual(await verify(await signed()), { issuer, subject: 'test-admin' });
  assert.deepEqual(await verify(await signed({ aud: [audience] })), { issuer, subject: 'test-admin' });
  for (const aud of [[audience, 'other'], ['other', audience], [audience, audience], 'other'])
    assert.equal(await verify(await signed({ aud })), null);
  assert.throws(() => fixture({ exclusiveAudience: 'yes' as any }), TypeError);
});

test('malformed, oversized, unsigned and token-controlled key URLs never fetch keys', async () => {
  const { verify, calls } = fixture();
  for (const token of ['', 'invalid', 'x'.repeat(8186), 'eyJhbGciOiJub25lIn0.e30.'])
    assert.equal(await verify(token), null);
  for (const header of [{ kid: '' }, { jku: 'https://attacker.example.invalid/jwks' }, { x5u: 'https://attacker.example.invalid/cert' }])
    assert.equal(await verify(await signed({}, header)), null);
  const hmac = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'primary' }).sign(crypto.getRandomValues(new Uint8Array(32)));
  assert.equal(await verify(hmac), null);
  assert.equal(calls.length, 0);
});

test('explicit ES256 and JWT profile work without broadening the default profile', async () => {
  const publicKey = { ...await exportJWK(ec.publicKey), kid: 'ec', alg: 'ES256' };
  const { verify } = fixture({ algorithms: ['ES256'], tokenType: 'JWT', fetchImpl: async () => Response.json({ keys: [publicKey] }) });
  assert.deepEqual(await verify(await signed({}, { alg: 'ES256', kid: 'ec', typ: 'JWT' }, ec.privateKey)), { issuer, subject: 'test-admin' });
  assert.equal(await verify(await signed({}, { alg: 'ES256', kid: 'ec' }, ec.privateKey)), null);
});

test('key rotation refreshes after cooldown and unknown keys cannot cause a fetch storm', async t => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  let calls = 0;
  let keys = [rsaJwk];
  const { verify } = fixture({ fetchImpl: async () => { calls++; return Response.json({ keys }); } });
  assert.ok(await verify(await signed()));
  const rotated = await signed({}, { kid: 'rotated' }, second.privateKey);
  assert.equal(await verify(rotated), null);
  assert.equal(calls, 1);
  keys = [{ ...await exportJWK(second.publicKey), kid: 'rotated', alg: 'RS256' }];
  t.mock.timers.tick(30001);
  assert.ok(await verify(rotated));
  assert.equal(calls, 2);
  t.mock.timers.tick(600001);
  assert.ok(await verify(await signed({}, { kid: 'rotated' }, second.privateKey)));
  assert.equal(calls, 3);
});

test('unavailable key endpoints fail closed and retry only after elapsed failure cooldown', async () => {
  let elapsed = 0;
  let calls = 0;
  const { verify } = fixture({ monotonicNow: () => elapsed,
    fetchImpl: async () => { calls++; throw new Error('private transport detail'); } });
  const token = await signed();
  assert.equal(await verify(token), null);
  assert.equal(await verify(token), null);
  assert.equal(calls, 1);
  elapsed = 29999;
  assert.equal(await verify(token), null); assert.equal(calls, 1);
  elapsed = 30000;
  assert.equal(await verify(token), null);
  assert.equal(calls, 2);
});

test('failed and oversized key responses cannot be held open by cleanup', { timeout: 1000 }, async () => {
  const token = await signed();
  for (const kind of ['status', 'length', 'stream']) {
    let canceled = false;
    const response = new Response(new ReadableStream({
      start(c) { if (kind === 'stream') c.enqueue(new Uint8Array(65537)); },
      cancel() { canceled = true; return new Promise<void>(() => {}); },
    }), { status: kind === 'status' ? 503 : 200, headers: kind === 'length' ? { 'Content-Length': '65537' } : {} });
    assert.equal(await fixture({ fetchImpl: async () => response }).verify(token), null);
    assert.equal(canceled, true);
  }
});

test('key deadline ends an ignored abort and discards a late response', { timeout: 1000 }, async () => {
  const deadline = new AbortController();
  let entered!: () => void, finish!: (response: Response) => void, canceled = false;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const { verify } = fixture({ timeoutSignal: ms => { assert.equal(ms, 5000); return deadline.signal; },
    fetchImpl: async () => { entered(); return new Promise<Response>(resolve => { finish = resolve; }); } });
  const verifying = verify(await signed()); await ready; deadline.abort();
  assert.equal(await verifying, null);
  finish(new Response(new ReadableStream({ cancel() { canceled = true; return new Promise<void>(() => {}); } })));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(canceled, true);
});

test('caller cancellation leaves a shared key fetch available to another verification', { timeout: 1000 }, async () => {
  const controller = new AbortController(); let calls = 0;
  let entered!: () => void, finish!: (response: Response) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const { verify } = fixture({ fetchImpl: async () => { calls++; entered(); return new Promise(resolve => { finish = resolve; }); } });
  const token = await signed(), canceled = verify(token, { signal: controller.signal }); await ready;
  const other = verify(token); controller.abort();
  assert.equal(await canceled, null);
  finish(Response.json({ keys: [rsaJwk] }));
  assert.deepEqual(await other, { issuer, subject: 'test-admin' }); assert.equal(calls, 1);
  assert.equal(await verify(token, { signal: controller.signal }), null); assert.equal(calls, 1);
});

test('injected JWT time covers expiry, not-before and issued-at boundaries', async () => {
  const at = Date.UTC(2026, 9, 22), now = at / 1000;
  for (const tolerance of [0, 5]) {
    const { verify } = fixture({ now: () => at, clockToleranceSeconds: tolerance });
    for (const offset of [-1, 0, 1]) {
      const expiry = await signed({ iat: now - 100, exp: now - tolerance + offset });
      assert.equal(Boolean(await verify(expiry)), offset > 0);
      const notBefore = await signed({ iat: now - 100, exp: now + 300, nbf: now + tolerance + offset });
      assert.equal(Boolean(await verify(notBefore)), offset <= 0);
      const issued = await signed({ iat: now + tolerance + offset, exp: now + 300 });
      assert.equal(Boolean(await verify(issued)), offset <= 0);
    }
  }
  const defaultVerify = createOidcVerifier({ issuer, audience, jwksUri: config.jwksUri, now: () => at,
    fetchImpl: async () => Response.json({ keys: [rsaJwk] }) });
  assert.equal(await defaultVerify(await signed({ iat: now - 100, exp: now - 5 })), null);
  assert.ok(await defaultVerify(await signed({ iat: now - 100, exp: now - 4 })));
  for (const at of [NaN, Infinity, -1]) {
    const { verify, calls } = fixture({ now: () => at });
    assert.equal(await verify(await signed()), null); assert.equal(calls.length, 0);
  }
});

test('key acquisition cannot make an expired token succeed using the earlier clock snapshot', async () => {
  let at = Date.UTC(2026, 9, 22); const start = at / 1000;
  const { verify } = fixture({ now: () => at, fetchImpl: async () => { at += 6000; return Response.json({ keys: [rsaJwk] }); } });
  assert.equal(await verify(await signed({ iat: start - 100, exp: start + 1 })), null);
});

test('redirect, oversized, malformed and private key sets are refused', async () => {
  const bodies = [
    () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example.invalid' } }),
    () => new Response('x'.repeat(65537)),
    () => new Response('{}', { headers: { 'Content-Length': '65537' } }),
    () => new Response('{'), () => Response.json({ keys: [] }),
    () => Response.json({ keys: Array(33).fill(rsaJwk) }),
    () => Response.json({ keys: [{ ...rsaJwk, d: 'private-field' }] }),
  ];
  const token = await signed();
  for (const body of bodies) assert.equal(await fixture({ fetchImpl: async () => body() }).verify(token), null);
});

test('a stalled JWKS body is cancelled within the key-fetch timeout', async () => {
  const keepAlive = setTimeout(() => {}, 6000); // AbortSignal.timeout uses an unref timer in Node.
  let cancelled = false;
  const { verify } = fixture({ fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  try {
    assert.equal(await verify(await signed()), null);
    assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});

test('invalid trusted configuration throws before any request', () => {
  for (const options of [
    { issuer: 'http://identity.example.invalid' }, { issuer: `${issuer}/?query=1` },
    { jwksUri: 'https://user:pass@identity.example.invalid/jwks' }, { jwksUri: `${issuer}/jwks#fragment` },
    { audience: '' }, { algorithms: [] }, { algorithms: ['HS256'] }, { clockToleranceSeconds: 61 },
  ]) assert.throws(() => createOidcVerifier({ ...config, ...options } as OidcOptions), TypeError);
});
