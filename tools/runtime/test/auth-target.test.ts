import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installation } from '../installation.ts';
import { authDeploymentTarget } from '../auth-target.ts';

test('Better Auth configuration preserves account, isolated DB and exact OIDC topology and rejects mismatches', () => {
  const accountId = crypto.randomUUID().replaceAll('-', ''), origin = 'https://test-admin.fixture.workers.dev';
  const issuer = 'https://test-auth.fixture.workers.dev/api/auth';
  const input = { adminOrigin: origin,
    admin: { workerName: 'test-admin', accountId, collectorWorkerName: 'test-collector', workersDev: true },
    collector: { workerName: 'test-collector', accountId, databaseName: 'test-db', databaseId: crypto.randomUUID(), workersDev: false,
      settings: { ADMIN_AUTH_MODE: 'oidc', OIDC_ISSUER: issuer, OIDC_AUDIENCE: origin + '/v1', OIDC_JWKS_URI: issuer + '/jwks', OIDC_ALGORITHMS: 'ES256' } },
    login: { issuer, clientId: 'tallyfin-admin', scope: 'openid profile offline_access', resource: origin + '/v1', idTokenAlgorithm: 'ES256' },
  };
  const plan = installation(input, process.cwd());
  const target = { workerName: 'test-auth', databaseName: 'test-auth-db', databaseId: crypto.randomUUID(), adminEmail: 'Operator@example.invalid', workersDev: true };
  const config = authDeploymentTarget(target, plan, process.cwd());
  assert.equal(config.account_id, accountId); assert.equal(config.vars.ADMIN_ORIGIN, origin);
  assert.equal(config.vars.ADMIN_EMAIL, 'operator@example.invalid'); assert.equal(config.vars.AUTH_ORIGIN, new URL(issuer).origin);
  assert.deepEqual(config.secrets.required, ['BETTER_AUTH_SECRET']); assert.ok(!JSON.stringify(config).includes('password'));
  for (const change of [{ databaseId: input.collector.databaseId }, { databaseId: '00000000-0000-0000-0000-000000000000' },
    { workerName: 'test-admin' }, { workerName: 'wrong-auth' }, { workersDev: false }, { domain: 'wrong.invalid' },
    { adminEmail: 'bad' }, { secret: 'not-allowed' }]) assert.throws(() => authDeploymentTarget({ ...target, ...change }, plan, process.cwd()));
  for (const login of [{ clientId: 'other' }, { resource: 'https://different.invalid' }, { idTokenAlgorithm: 'RS256' }, { scope: 'openid profile' }])
    assert.throws(() => authDeploymentTarget(target, installation({ ...input, login: { ...input.login, ...login } }, process.cwd()), process.cwd()));
});
