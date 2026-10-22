import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionError } from '@tallyfin/core';
import type { AdminStore } from '@tallyfin/core';
import { administrator } from '../src/admin.ts';

test('route extraction preserves authentication, permission and body-error precedence', async () => {
  for (const [path, method, permitted, expected, steps] of [
    ['/grants', 'PUT', false, 403, ['auth', 'settings']],
    ['/publishers', 'DELETE', false, 403, ['auth', 'settings']],
    ['/schemas/validate', 'POST', false, 403, ['auth', 'settings']],
    ['/schemas/2', 'PUT', false, 403, ['auth', 'settings']],
    ['/grants', 'PUT', true, 400, ['auth', 'settings']],
    ['', 'PATCH', false, 400, ['auth']],
    ['/schemas/bad', 'PUT', false, 400, ['auth']],
  ] as const) {
    const calls: string[] = [];
    const request = new Request(`https://collector.example.invalid/v1/projects/example${path}`, { method,
      headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, body: '{' });
    const access = { verifyBearer: async () => { calls.push('auth'); return { issuer: 'test', subject: 'admin' }; },
      store: { settings: async () => { calls.push('settings'); return { canEdit: permitted }; },
        updateSettings: async () => { calls.push('update'); throw new CollectionError('forbidden', 403); },
      } as unknown as AdminStore };
    await assert.rejects(administrator(request, access, 0), e => e instanceof CollectionError && e.status === expected);
    assert.deepEqual(calls, steps);
    assert.equal(request.bodyUsed, expected === 400 && (method === 'PATCH' || permitted));
  }
  const request = new Request('https://collector.example.invalid/v1/projects/bad!/grants', { method: 'PUT', body: '{' });
  await assert.rejects(administrator(request, undefined, 0), e => e instanceof CollectionError && e.status === 401);
  assert.equal(request.bodyUsed, false);
});
