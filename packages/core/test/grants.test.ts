import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGrantChange, validateGrantChange, validGrantIdentity } from '../src/index.ts';

const input = { issuer: 'https://identity.example.invalid', subject: 'test-reader', role: 'reader', expectedRole: null };
test('grant changes are closed, bounded and keep expected and requested role separate', () => {
  assert.deepEqual(parseGrantChange(input, 'PUT'), input);
  assert.deepEqual(parseGrantChange({ issuer: input.issuer, subject: input.subject, expectedRole: 'reader' }, 'DELETE'), { ...input, role: null, expectedRole: 'reader' });
  assert.deepEqual(validateGrantChange({ ...input, role: null }), { ...input, role: null });
  for (const value of [null, [], {}, { ...input, role: null }, { ...input, role: 'admin' }, { ...input, expectedRole: undefined },
    { ...input, expectedRole: 'admin' }, { ...input, issuer: 'http://example.invalid' }, { ...input, issuer: `${input.issuer}?x=1` },
    { ...input, issuer: `${input.issuer}#x` }, { ...input, issuer: ` ${input.issuer}` }, { ...input, issuer: 'https://user:pass@example.invalid' },
    { ...input, subject: ' ' }, { ...input, subject: 'a\nb' }, { ...input, subject: 'x'.repeat(513) }, { ...input, issuer: 'x'.repeat(513) },
    { ...input, caller: 'asserted-owner' }, { ...input, projectId: 'other' }])
    assert.throws(() => parseGrantChange(value, 'PUT'), { code: 'invalid_request' });
  assert.throws(() => parseGrantChange(input, 'DELETE'), { code: 'invalid_request' });
  assert.equal(validGrantIdentity(input.issuer, '한😀'.repeat(170)), true);
});
