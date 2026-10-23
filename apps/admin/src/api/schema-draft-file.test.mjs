import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSchemaDraftFile, schemaDraftFile, SCHEMA_DRAFT_FILE_LIMIT } from './schema-draft-file.ts';

test('draft files preserve unfinished JSON, Unicode and invalid version input without credentials or approvals', () => {
  for (const [target, draft] of [['', ''], ['0', '{"events": [한글\n'], ['2147483647', '{"events":[],"workflows":[]}']]) {
    const file = schemaDraftFile('sample', target, draft);
    assert.equal(file.filename, 'tallyfin-sample-schema-draft.json');
    assert.deepEqual(parseSchemaDraftFile(file.text, 'sample'), {
      format: 'tallyfin.schema-draft/v1', projectId: 'sample', targetVersion: target, draftText: draft,
    });
  }
});

test('envelope rejects cross-project, malformed, unknown fields and limits UTF-8 bytes including escaping', () => {
  const file = JSON.parse(schemaDraftFile('sample', '2', '{').text);
  for (const value of [null, [], {}, { ...file, format: 'tallyfin.schema-draft/v2' }, { ...file, projectId: 'other' },
    { ...file, projectId: '../sample' }, { ...file, targetVersion: 2 }, { ...file, targetVersion: 'x'.repeat(33) },
    { ...file, draftText: {} }, { ...file, privacyReviewed: true }])
    assert.throws(() => parseSchemaDraftFile(JSON.stringify(value), 'sample'));
  assert.throws(() => parseSchemaDraftFile('{', 'sample'));
  assert.throws(() => schemaDraftFile('sample', '2', '\0'.repeat(SCHEMA_DRAFT_FILE_LIMIT / 6)));
  assert.throws(() => schemaDraftFile('sample', '2', '한'.repeat(SCHEMA_DRAFT_FILE_LIMIT / 3)));
  const text = schemaDraftFile('sample', '2', '').text.trimEnd();
  const boundary = text + ' '.repeat(SCHEMA_DRAFT_FILE_LIMIT - Buffer.byteLength(text));
  assert.equal(parseSchemaDraftFile(boundary, 'sample').draftText, '');
  assert.throws(() => parseSchemaDraftFile(boundary + ' ', 'sample'));
});
