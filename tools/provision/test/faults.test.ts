import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { CreatorProvisioner } from '../creators.ts';
import { remoteCreatorQuery } from '../remote-wrangler.ts';
import { CollectionError } from '@tallyfin/core';

test('creator apply distinguishes zero-row CAS from uncertain transport failure without retry', async () => {
  const cause = new Error('private transport detail');
  for (const outcome of ['conflict', 'unavailable']) {
    let calls = 0;
    const statement = { bind() { return this; } };
    const tool = new CreatorProvisioner({ prepare: () => statement, async batch() {
      if (++calls === 1) return [{ success: true, results: [], meta: { changes: 0 } }, { success: true, results: [{ n: 0 }], meta: { changes: 0 } }];
      if (outcome === 'unavailable') throw cause;
      return [{ success: true, results: [], meta: { changes: 0 } }];
    } } as never);
    const plan = await tool.plan('creator-grant', { issuer: 'https://identity.example.invalid', subject: 'operator', maxProjects: 1 });
    await assert.rejects(tool.apply(plan), error => {
      const value = error as Error & { code: string };
      assert.equal(value.code, outcome === 'conflict' ? 'apply_conflict' : 'database_unavailable');
      if (outcome === 'unavailable') assert.equal(value.cause, cause);
      assert.equal(JSON.stringify(value).includes(cause.message), false); return true;
    });
    assert.equal(calls, 2);
  }
});

test('remote cleanup cannot replace a primary error or imply an unexecuted query', async () => {
  const target = { accountId: crypto.randomUUID().replaceAll('-', ''), databaseId: crypto.randomUUID(),
    databaseName: 'test-db', workerName: 'test-worker', issuer: 'https://identity.example.invalid' };
  for (const failed of [false, true]) {
    const cause = new Error('private execution detail'), cleanupCause = new Error('private cleanup detail');
    let scratch = '', calls = 0;
    const query = remoteCreatorQuery(process.cwd(), target, async () => {
      calls++; if (failed) throw cause; return { stdout: '[]' };
    }, async directory => { scratch = directory; throw cleanupCause; });
    try {
      await assert.rejects(query('SELECT 1'), error => {
        const value = error as Error & { code: string; cleanupCause: unknown };
        assert.equal(value.code, failed ? 'database_unavailable' : 'cleanup_failed');
        assert.equal(value.cause, failed ? cause : cleanupCause);
        if (failed) assert.equal(value.cleanupCause, cleanupCause);
        assert.equal(JSON.stringify(value).includes('private'), false); return true;
      });
      assert.equal(calls, 1);
    } finally {
      assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep + 'tallyfin-creator-query-'));
      await rm(scratch, { recursive: true, force: true });
    }
  }
});

test('collection errors keep causes out of serialized public error data', () => {
  const cause = new Error('private SQL detail'), error = new CollectionError('storage_unavailable', 503, { cause });
  assert.equal(error.cause, cause);
  assert.equal(JSON.stringify(error).includes(cause.message), false);
});
