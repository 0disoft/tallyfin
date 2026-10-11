import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { createBenchmarkTokens } from '../benchmark-tokens.ts';

test('local signed credentials renew before expiry with separate audiences and one signature per concurrent refresh', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  let now = 1800000000000, calls = 0;
  const tokens = createBenchmarkTokens(async (audience, issuedAt, expiresAt) => {
    calls++;
    return new SignJWT({}).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer('https://identity.example.invalid').setSubject('synthetic-benchmark-operator')
      .setAudience(audience).setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(privateKey);
  }, () => now);
  const first = await tokens.getAdminToken(), publisher = await tokens.getPublisherToken();
  const verify = (token: string, audience: string) => jwtVerify(token, publicKey, { algorithms: ['RS256'],
    issuer: 'https://identity.example.invalid', audience, currentDate: new Date(now) });
  assert.equal((await verify(first, 'benchmark-admin')).payload.exp, now / 1000 + 300);
  await assert.rejects(verify(first, 'benchmark-publisher'));
  assert.equal(await tokens.getAdminToken(), first); assert.equal(calls, 2);
  now += 269999; assert.equal(await tokens.getAdminToken(), first);
  now += 1;
  const renewed = await Promise.all(Array.from({ length: 16 }, () => tokens.getAdminToken()));
  assert.ok(renewed.every(token => token === renewed[0])); assert.notEqual(renewed[0], first); assert.equal(calls, 3);
  now += 31000; await assert.rejects(verify(first, 'benchmark-admin'));
  assert.equal((await verify(renewed[0]!, 'benchmark-admin')).payload.aud, 'benchmark-admin');
  const newPublisher = await tokens.getPublisherToken(); assert.notEqual(newPublisher, publisher);
  await verify(newPublisher, 'benchmark-publisher'); assert.deepEqual(tokens.issuanceCounts(), { admin: 2, publisher: 2 });
});

test('failed or stalled token signing cannot cache an invalid credential or leak pending state', async () => {
  let now = 1800000000000, fail = true;
  const tokens = createBenchmarkTokens(async () => { if (fail) throw Error('signing-unavailable'); return 'unit-test-opaque-value'; }, () => now);
  await assert.rejects(tokens.getAdminToken(), /signing-unavailable/); assert.deepEqual(tokens.issuanceCounts(), { admin: 0, publisher: 0 });
  fail = false; await tokens.getAdminToken(); assert.equal(tokens.issuanceCounts().admin, 1);
  const stalled = createBenchmarkTokens(async () => { now += 300000; return 'unit-test-opaque-value'; }, () => now);
  await assert.rejects(stalled.getAdminToken(), /invalid-benchmark-token/); assert.equal(stalled.issuanceCounts().admin, 0);
  for (const value of [NaN, -1, Number.MAX_SAFE_INTEGER])
    await assert.rejects(createBenchmarkTokens(async () => '', () => value).getAdminToken(), /invalid-benchmark-clock/);
});
