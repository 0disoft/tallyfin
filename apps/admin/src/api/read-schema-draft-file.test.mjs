import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSchemaDraftFile } from './read-schema-draft-file.ts';
import { SCHEMA_DRAFT_FILE_LIMIT, parseSchemaDraftFile, schemaDraftFile } from './schema-draft-file.ts';

function fixture() {
  const reader = { readyState: 0, result: null, error: null, onload: null, onerror: null, onabort: null, reads: 0, aborts: 0,
    readAsArrayBuffer() { this.reads++; this.readyState = 1; },
    abort() { this.aborts++; this.readyState = 2; this.onabort?.(); },
  };
  return { reader, createReader: () => reader, complete(bytes) {
    reader.result = Uint8Array.from(bytes).buffer; reader.readyState = 2; reader.onload?.();
  } };
}
const bytes = text => new TextEncoder().encode(text);
const clean = reader => { assert.equal(reader.onload, null); assert.equal(reader.onerror, null); assert.equal(reader.onabort, null); };

test('native bytes preserve Unicode/unfinished JSON and remove only a UTF-8 file BOM', async () => {
  const text = schemaDraftFile('sample', '', '{한글\n').text, f = fixture();
  const pending = readSchemaDraftFile(new Blob([text]), f);
  f.complete(bytes('\ufeff' + text));
  assert.equal(await pending, text); assert.equal(parseSchemaDraftFile(text, 'sample').draftText, '{한글\n');
  clean(f.reader); assert.equal(f.reader.aborts, 0);
});

test('byte boundary permits exactly 128KiB and rejects the next byte before creating a reader', async () => {
  const f = fixture(), exact = new Uint8Array(SCHEMA_DRAFT_FILE_LIMIT).fill(32);
  const pending = readSchemaDraftFile(new Blob([exact]), f); f.complete(exact);
  assert.equal((await pending).length, SCHEMA_DRAFT_FILE_LIMIT); clean(f.reader);
  let created = 0;
  await assert.rejects(readSchemaDraftFile(new Blob([exact, ' ']), { createReader: () => { created++; return f.reader; } }), /128KiB/);
  assert.equal(created, 0);
});

test('invalid UTF-8 is rejected rather than silently replacing unfinished draft contents', async () => {
  const f = fixture(), pending = readSchemaDraftFile(new Blob(['x']), f);
  f.complete([0xc3, 0x28]);
  await assert.rejects(pending, error => /UTF-8/.test(error.message) && error.cause instanceof TypeError);
  clean(f.reader);
});

test('caller cancellation releases reader and listener; a late onload cannot restore text', async () => {
  const f = fixture(), controller = new AbortController(), reason = Error('user cancelled');
  const pending = readSchemaDraftFile(new Blob(['x']), { ...f, signal: controller.signal });
  const late = f.reader.onload;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(f.reader.aborts, 1); clean(f.reader);
  f.reader.result = bytes('late').buffer; late(); clean(f.reader);
});

test('timeout aborts the read and detaches callbacks', async () => {
  const f = fixture();
  await assert.rejects(readSchemaDraftFile(new Blob(['x']), { ...f, timeoutMs: 5 }), /시간/);
  assert.equal(f.reader.aborts, 1); clean(f.reader);
});

test('native failure and synchronous read exceptions preserve cause and clean up', async () => {
  const f = fixture(), cause = Error('local disk');
  const pending = readSchemaDraftFile(new Blob(['x']), f);
  f.reader.error = cause; f.reader.readyState = 2; f.reader.onerror();
  await assert.rejects(pending, error => error.cause === cause); clean(f.reader);
  const g = fixture(); g.reader.readAsArrayBuffer = () => { throw cause; };
  await assert.rejects(readSchemaDraftFile(new Blob(['x']), g), error => error.cause === cause); clean(g.reader);
});

test('pre-cancelled reads, invalid deadlines and empty files have bounded outcomes', async () => {
  const controller = new AbortController(), reason = Error('gone'); controller.abort(reason);
  await assert.rejects(readSchemaDraftFile(new Blob(), { signal: controller.signal, createReader: () => { throw Error('must not create'); } }), error => error === reason);
  for (const timeoutMs of [0, -1, Infinity, NaN]) await assert.rejects(readSchemaDraftFile(new Blob(), { timeoutMs }), /시간/);
  const f = fixture(), pending = readSchemaDraftFile(new Blob(), f); f.complete([]);
  assert.equal(await pending, ''); assert.throws(() => parseSchemaDraftFile('', 'sample')); clean(f.reader);
});
