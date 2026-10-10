import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureCollector, DEFAULT_SETTINGS, readSettings } from '../src/config.ts';
import { readFile } from 'node:fs/promises';

test('collector config rejects partial auth and invalid flags without making a network request', async () => {
  const oidc = { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid',
    OIDC_AUDIENCE: 'test-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' };
  const original = globalThis.fetch; let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw Error('must not fetch during configuration'); };
  try {
    assert.ok(configureCollector(DEFAULT_SETTINGS));
    assert.ok(configureCollector(oidc));
    for (const bad of [
      { ...DEFAULT_SETTINGS, ADMIN_AUTH_MODE: '' }, { ...DEFAULT_SETTINGS, ALLOW_LOCAL_HTTP: 'yes' },
      { ...DEFAULT_SETTINGS, OIDC_ISSUER: oidc.OIDC_ISSUER }, { ...oidc, OIDC_AUDIENCE: '' },
      { ...oidc, OIDC_JWKS_URI: 'http://localhost/keys' }, { ...oidc, OIDC_ALGORITHMS: 'RS256,RS256' },
      { ...oidc, OIDC_TOKEN_TYPE: 'ID_TOKEN' }, { ...oidc, OIDC_CLOCK_TOLERANCE_SECONDS: '61' },
      { ...oidc, OIDC_ISSUER: `${oidc.OIDC_ISSUER}?private=do-not-log` },
    ]) assert.throws(() => configureCollector(bad), { message: 'Invalid collector configuration' });
    assert.equal(fetched, false);
    assert.equal(readSettings(DEFAULT_SETTINGS).allowLocalHttp, false);
  } finally { globalThis.fetch = original; }
  const config = JSON.parse((await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(config.vars, DEFAULT_SETTINGS);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.traces.enabled, false);
});

test('publisher auth is opt-in, independently configured and cannot share the admin API audience', () => {
  const publisher = { ...DEFAULT_SETTINGS, PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: 'https://machine.example.invalid',
    PUBLISHER_OIDC_AUDIENCE: 'server-events', PUBLISHER_OIDC_JWKS_URI: 'https://machine.example.invalid/jwks' };
  assert.ok(configureCollector(publisher));
  assert.equal(readSettings(publisher).oidc, null);
  assert.equal(readSettings(publisher).publisherOidc?.audience, 'server-events');
  const both = { ...publisher, ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://identity.example.invalid',
    OIDC_AUDIENCE: 'admin-api', OIDC_JWKS_URI: 'https://identity.example.invalid/jwks' };
  assert.ok(configureCollector(both));
  for (const bad of [
    { ...publisher, PUBLISHER_AUTH_MODE: '' }, { ...publisher, PUBLISHER_AUTH_MODE: 'disabled' },
    { ...publisher, PUBLISHER_OIDC_AUDIENCE: '' }, { ...publisher, PUBLISHER_OIDC_JWKS_URI: 'http://localhost/keys' },
    { ...publisher, PUBLISHER_OIDC_ALGORITHMS: 'HS256' }, { ...publisher, PUBLISHER_OIDC_TOKEN_TYPE: 'ID_TOKEN' },
    { ...publisher, PUBLISHER_OIDC_CLOCK_TOLERANCE_SECONDS: '61' }, { ...both, PUBLISHER_OIDC_AUDIENCE: 'admin-api' },
  ]) assert.throws(() => configureCollector(bad), { message: 'Invalid collector configuration' });
  const old: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(old)) if (key.startsWith('PUBLISHER_')) delete old[key];
  assert.equal(readSettings(old).publisherOidc, null);
  assert.ok(configureCollector(old));
});
