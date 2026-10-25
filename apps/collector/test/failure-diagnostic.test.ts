import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CollectionError } from '@tallyfin/core';
import type { CollectionStore } from '@tallyfin/core';
import { createCollector } from '../src/handler.ts';
import { failureKind } from '../src/failure-diagnostic.ts';
import type { FailureDiagnostic } from '../src/failure-diagnostic.ts';
import { registry, batch, now } from '../../../packages/storage-d1/test/helpers.ts';

test('failure classifiers project only fixed categories and terminate cyclic causes', () => {
  for (const [message, kind] of [['Database capacity exceeded','capacity'], ['D1_ERROR: database reset, private SQL','database_reset'],
    ['SQLITE_BUSY private SQL','database_busy'], ['D1 overloaded: private SQL','database_overloaded'],
    ['too many API requests by single invocation','platform_limit'], ['SQLITE_CONSTRAINT private SQL','constraint'],
    ['D1 DB exceeded its CPU time limit and was reset.','platform_limit'],
    ["D1 DB's isolate exceeded its memory limit and was reset.",'platform_limit'],
    ['D1 DB storage operation exceeded timeout which caused object to be reset.','database_timeout'],
    ['D1_ERROR: private unexpected SQL failure','database_error'],
    ['network connection lost private data','transport'], ['tallyfin_ingest_revision private SQL','revision_conflict']] as const)
    assert.equal(failureKind(new CollectionError('storage_unavailable',503,{cause:new Error(message)})),kind);
  assert.equal(failureKind(new DOMException('private deadline','TimeoutError')),'deadline');
  assert.equal(failureKind(new DOMException('private cancellation','AbortError')),'cancelled');
  assert.equal(failureKind(new Error('D1_ERROR', {cause:new DOMException('private','TimeoutError')})),'deadline');
  const cyclic = new Error('private unknown');cyclic.cause=cyclic;
  assert.equal(failureKind(cyclic),'unknown');
});

test('503 diagnostics identify the failing phase without changing receipts or exporting cause text', async () => {
  for (const [method, stage, kind, message] of [['loadProject','project','database_reset','D1_ERROR: database reset'],
    ['loadRegistry','registry','database_busy','SQLITE_BUSY'],['commit','commit','transport','network connection lost']] as const) {
    const entries: FailureDiagnostic[]=[];
    const store: CollectionStore={loadProject:async()=>({...registry.project,allowedOrigins:registry.allowedOrigins,limits:registry.limits}),
      admit:async()=>true,loadRegistry:async()=>registry,commit:async()=>({accepted:2,duplicates:0}),recordRejection:async()=>{}};
    store[method]=async()=>{throw Error(message+' private SQL and body');};
    const request=new Request('https://collector.example.invalid/v1/projects/sembom/batches',{method:'POST',headers:{Origin:registry.allowedOrigins[0]!},body:JSON.stringify(batch())});
    const response=await createCollector(store,{now:()=>now,observeFailure:e=>{entries.push(e);throw Error('private diagnostic sink');}})(request);
    assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'1');
    const body=await response.json() as {error:{requestId:string}};
    assert.deepEqual(entries,[{requestId:body.error.requestId,stage,kind}]);
    assert.ok(!JSON.stringify(entries).includes('private'));assert.ok(!JSON.stringify(body).includes('private'));
  }
});
