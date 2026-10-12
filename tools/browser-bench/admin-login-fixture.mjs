import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS } from '../../apps/collector/src/config.ts';
import { initialize } from '../provision/local.ts';
import { Provisioner } from '../provision/store.ts';
import { CreatorProvisioner } from '../provision/creators.ts';
import { readFile } from 'node:fs/promises';

// Test-only provider. Keys, codes and tokens are ephemeral; no external identity service is contacted.
export async function adminLoginFixture(directory, { profile = 'login' } = {}) {
  assert.ok(['login', 'onboarding', 'access', 'goals'].includes(profile));
  const issuer = 'https://identity.example.invalid', clientId = 'tallyfin-smoke-public';
  const audience = 'tallyfin-smoke-api', resource = 'urn:tallyfin:smoke:api';
  const subject = 'synthetic-login-operator';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const kid = 'ephemeral-login-smoke';
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid, alg: 'RS256' }] };
  const codes = new Map();
  let access, refresh, origin, mode = 'normal', exchanges = 0, refreshes = 0, authorizations = 0, apiReads = 0, apiWrites = 0, browserBatches = 0;
  const sign = (claims, target, typ) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid, typ })
    .setIssuer(issuer).setSubject(subject).setAudience(target).setIssuedAt().setExpirationTime('20m').sign(privateKey);
  const tokens = async nonce => {
    const value = await sign({ jti: crypto.randomUUID() }, audience, 'at+jwt'); access = value;
    refresh = crypto.randomUUID();
    return { access_token: value, refresh_token: refresh, token_type: 'Bearer', expires_in: 300,
      ...(nonce ? { id_token: await sign({ nonce }, clientId, 'JWT') } : {}) };
  };
  const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    contents: `import worker from './apps/collector/src/runtime.ts';
      console.log = console.info = console.warn = () => {}; // Keep test-only sampled observations out of the CLI report stream.
      globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)}); export default worker;` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-06',
    host: '127.0.0.1', port: 0, d1Databases: { DB: crypto.randomUUID() }, d1Persist: join(directory, 'state'),
    bindings: { ...DEFAULT_SETTINGS, ALLOW_LOCAL_HTTP: profile === 'onboarding' ? 'true' : 'false', ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience,
      OIDC_JWKS_URI: `${issuer}/jwks` }, log: new Log(LogLevel.NONE) });
  try {
    await mf.ready;
    const db = await mf.getD1Database('DB'); await initialize(db, true);
    if (profile === 'onboarding') {
      const creators = new CreatorProvisioner(db);
      await creators.apply(await creators.plan('creator-grant', { issuer, subject, maxProjects: 2 }));
    } else {
      const registry = JSON.parse(await readFile(new URL('../../api/examples/registry.json', import.meta.url), 'utf8'));
      if (profile === 'goals') registry.funnels = [{ id: 'calculation_funnel', label: '계산 퍼널',
        steps: ['input_start', 'calculation_success'].map(eventName => ({ eventName, source: 'browser' })), dimensions: ['tool'] }];
      const provisioner = new Provisioner(db);
      await provisioner.apply(await provisioner.plan('register', registry), Date.now());
      await provisioner.apply(await provisioner.plan('grant', { projectId: registry.project.id, issuer, subject, role: 'owner' }), Date.now());
      if (profile === 'access' || profile === 'goals') {
        await provisioner.apply(await provisioner.plan('grant', { projectId: registry.project.id, issuer,
          subject: 'synthetic-backup-operator', role: 'owner' }));
        const other = structuredClone(registry); other.project.id = 'access-other'; other.project.name = 'Other access fixture';
        await provisioner.apply(await provisioner.plan('register', other));
        await provisioner.apply(await provisioner.plan('grant', { projectId: other.project.id, issuer, subject, role: 'owner' }));
      }
    }
    return { mf, db, issuer, clientId, resource,
      configure(value) { origin = value; },
      setMode(value) { assert.ok(['normal', 'bad-state', 'refresh-error'].includes(value)); mode = value; },
      async setRole(role) {
        assert.equal(profile, 'access'); assert.ok(['owner', 'reader'].includes(role));
        const provisioner = new Provisioner(db);
        await provisioner.apply(await provisioner.plan('grant', { projectId: 'sembom', issuer, subject, role }));
      },
      get counts() { return { authorizations, exchanges, refreshes, apiReads, apiWrites, browserBatches }; },
      async route(route, { dropResponse = false, afterCommit } = {}) {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin) {
          if (url.pathname.startsWith('/v1/')) {
            const headers = await request.allHeaders();
            if (profile === 'onboarding' && url.pathname.endsWith('/batches')) {
              assert.equal(request.method(), 'POST'); assert.equal(headers.authorization, undefined); browserBatches++;
            } else {
              if (profile === 'login') assert.equal(request.method(), 'GET');
              assert.ok(access && headers.authorization === `Bearer ${access}`);
              if (request.method() === 'GET') apiReads++; else apiWrites++;
            }
          }
          if (dropResponse || afterCommit) {
            // Test only: execute the authenticated write against real local D1,
            // then lose its successful response before the page can observe it.
            assert.ok(dropResponse ? ['onboarding', 'access'].includes(profile) : profile === 'access');
            assert.ok(url.pathname.startsWith('/v1/'));
            if (dropResponse && profile === 'onboarding') assert.ok(['POST', 'PUT'].includes(request.method()));
            else {
              assert.equal(request.method(), 'PATCH');
              assert.ok(['/v1/projects/sembom', '/v1/projects/access-other'].includes(url.pathname));
            }
            const committed = await route.fetch({ maxRedirects: 0, timeout: 15000 });
            try {
              assert.ok(committed.ok());
              if (dropResponse) return await route.abort('failed');
              await afterCommit();
              return await route.fulfill({ response: committed });
            } finally { await committed.dispose(); }
          }
          return route.continue();
        }
        if (url.origin !== issuer) return route.abort();
        const headers = { 'access-control-allow-origin': origin, 'cache-control': 'no-store' };
        const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers,
          'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' } });
        if (url.pathname === '/.well-known/openid-configuration') return json({ issuer,
          authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'], id_token_signing_alg_values_supported: ['RS256'] });
        if (url.pathname === '/jwks') return json(jwks);
        if (url.pathname === '/authorize') {
          authorizations++;
          assert.equal(url.searchParams.get('client_id'), clientId);
          assert.equal(url.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
          assert.equal(url.searchParams.get('resource'), resource);
          assert.equal(url.searchParams.get('response_type'), 'code');
          assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
          assert.equal(url.searchParams.has('code_verifier'), false);
          const code = crypto.randomUUID();
          codes.set(code, { challenge: url.searchParams.get('code_challenge'), nonce: url.searchParams.get('nonce') });
          const callback = new URL(`${origin}/auth/callback`);
          callback.searchParams.set('code', code);
          callback.searchParams.set('state', mode === 'bad-state' ? 'invalid-state' : url.searchParams.get('state'));
          return route.fulfill({ status: 302, headers: { ...headers, location: callback.href } });
        }
        assert.equal(url.pathname, '/token'); assert.equal(request.method(), 'POST');
        const body = new URLSearchParams(request.postData());
        assert.equal(body.get('client_id'), clientId); assert.equal(body.get('resource'), resource);
        assert.equal(body.has('client_secret'), false);
        assert.equal((await request.allHeaders()).authorization, undefined);
        if (body.get('grant_type') === 'refresh_token') {
          refreshes++; assert.ok(refresh && body.get('refresh_token') === refresh);
          if (mode === 'refresh-error') return json({ error: 'invalid_grant', error_description: 'private-provider-detail' }, 400);
          return json(await tokens());
        }
        exchanges++; assert.equal(body.get('grant_type'), 'authorization_code');
        const pending = codes.get(body.get('code')); assert.ok(pending);
        codes.delete(body.get('code'));
        assert.equal(body.get('redirect_uri'), `${origin}/auth/callback`);
        assert.ok(createHash('sha256').update(body.get('code_verifier')).digest('base64url') === pending.challenge);
        return json(await tokens(pending.nonce));
      },
    };
  } catch (error) { await mf.dispose(); throw error; }
}
