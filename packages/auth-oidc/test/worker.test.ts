import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

test('native Workers global fetch verifies JWKS using manual redirects; redirect error is unsupported', async () => {
  const pair = await generateKeyPair('ES256');
  const key = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'ES256' };
  const issuer = 'https://identity.example.invalid', audience = 'worker-test-api';
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ iss: issuer, aud: audience, sub: 'test-operator', iat: now, exp: now + 300 })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: 'at+jwt' }).sign(pair.privateKey);
  const bundle = await build({ stdin: { contents: `import {createOidcVerifier} from './index.ts';
    const verify=createOidcVerifier({issuer:${JSON.stringify(issuer)},audience:${JSON.stringify(audience)},jwksUri:${JSON.stringify(issuer + '/jwks')},algorithms:['ES256']});
    export default {async fetch(request){try{return Response.json(await verify(request.headers.get('Authorization').slice(7),{throwDependencyErrors:true}))}
      catch{return new Response(null,{status:503})}}};`, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), sourcefile: 'worker-test.ts' },
    bundle: true, format: 'esm', platform: 'neutral', write: false });
  let calls = 0;
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text,
    compatibilityDate: '2026-07-30', log: new Log(LogLevel.NONE), outboundService: async request => {
      calls++; assert.equal(request.url, issuer + '/jwks');
      assert.equal(request.headers.has('Authorization'), false);
      return Response.json({ keys: [key] });
    } });
  try {
    const response = await mf.dispatchFetch('https://collector.example.invalid/v1/identity', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { issuer, subject: 'test-operator' }); assert.equal(calls, 1);
  } finally { await mf.dispose(); }
});
