import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmarkFailure } from '../benchmark-failure.ts';

test('benchmark failures retain only validated correlation fields', () => {
  const requestId = crypto.randomUUID();
  assert.deepEqual(benchmarkFailure({error:{code:'storage_unavailable',requestId,message:'private SQL'},token:'private'},'1'),
    {errorCode:'storage_unavailable',requestId,retryAfterSeconds:1});
  assert.deepEqual(benchmarkFailure({error:{code:'admin_api_unavailable'}},'5'),{errorCode:'admin_api_unavailable',retryAfterSeconds:5});
});

test('benchmark failures discard arbitrary strings, malformed IDs and unbounded retry headers', () => {
  for (const body of [null, 'private', {}, {error:'private'}, {error:{code:'private',requestId:'private'}}])
    for (const header of [null,'private','-1','1.5','999999','3601']) assert.deepEqual(benchmarkFailure(body,header),{});
});
