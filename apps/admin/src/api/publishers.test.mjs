import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from './client.ts';
import { PublisherList } from './publisher-list.ts';
import { PublisherEditor } from './publisher-editor.ts';
import { parseProjectPublisherPage, publisherCursor } from './publishers-contract.ts';

const issuer = 'https://machine.example.invalid';
// Deterministic lowercase 32-hex generations so the fixture matches the wire rule.
const gid = subject => [...String(subject)].reduce((hash, ch) => (hash * 33 + ch.codePointAt(0)) % 4294967296, 7)
  .toString(16).padStart(32, '0');
const row = (subject = 'build-bot', createdAt = '2026-10-11T00:00:00.000Z') =>
  ({ issuer, subject, grantId: gid(subject), createdAt });
const encode = (projectId, from, subject) => Buffer.from(JSON.stringify(['publishers', 1, projectId, from, subject]), 'utf8').toString('base64url');
const page = (subjects = ['build-bot'], nextCursor = null, limit = 25) =>
  ({ projectId: 'sembom', data: subjects.map(subject => row(subject)), page: { limit, nextCursor } });
// The list controller always asks for 25 rows, so a full page has exactly 25 ascending identities.
const fullPage = () => {
  const subjects = Array.from({ length: 25 }, (_, index) => 'u' + String(index).padStart(2, '0'));
  return page(subjects, encode('sembom', issuer, subjects.at(-1)), 25);
};
const grant = { granted: true, issuer, subject: 'build-bot' };
const revoke = { granted: false, issuer, subject: 'build-bot', expectedGrantId: gid('build-bot') };
const result = (request = grant, extra = {}) => ({ projectId: 'sembom', issuer: request.issuer, subject: request.subject,
  granted: request.granted, grantId: request.granted ? gid(request.subject) : null,
  createdAt: request.granted ? '2026-10-11T00:00:00.000Z' : null, changed: true, ...extra });
const response = value => ({ ok: true, status: 200, json: async () => value });
const failure = (status, code) => ({ ok: false, status, json: async () => ({ error: { code, message: 'private server details' } }) });
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('publisher page parser keeps the closed shape, BINARY byte order and the canonical position', () => {
  assert.deepEqual(parseProjectPublisherPage(page()), page());
  assert.deepEqual(parseProjectPublisherPage(page([])), page([]));
  assert.equal(parseProjectPublisherPage(page()).data[0].grantId, gid('build-bot'));
  // Ascending rows pass. The second pair only sorts correctly in UTF-8 bytes: a
  // naive UTF-16 comparison would order the astral character before U+FF21.
  assert.deepEqual(parseProjectPublisherPage(page(['a', 'b'])).data.map(item => item.subject), ['a', 'b']);
  assert.deepEqual(parseProjectPublisherPage(page(['Ａ', '😀'])).data.map(item => item.subject), ['Ａ', '😀']);
  assert.throws(() => parseProjectPublisherPage(page(['😀', 'Ａ'])));
  const unicode = page(['가😀"'.repeat(127)]);
  assert.equal(parseProjectPublisherPage(unicode).data[0].subject, unicode.data[0].subject);
  // Subjects are opaque non-blank text: leading whitespace is preserved exactly, blank or control text is not.
  assert.equal(parseProjectPublisherPage(page([' build-bot'])).data[0].subject, ' build-bot');
  assert.throws(() => parseProjectPublisherPage(page(['  '])));
  assert.throws(() => parseProjectPublisherPage(page(['build\u0000bot'])));
  const limited = () => ({ projectId: 'sembom', data: [row('alpha'), row('zeta')],
    page: { limit: 2, nextCursor: encode('sembom', issuer, 'zeta') } });
  assert.deepEqual(parseProjectPublisherPage(limited()), limited());
  for (const mutate of [
    v => v.data.reverse(), v => v.data.push(v.data[0]), v => v.projectId = 'BAD', v => v.extra = true,
    v => v.data[0].role = 'owner', v => v.data[0].createdAt = '2026-10-11T00:00:00Z', v => v.data[0].createdAt = '2026-02-30T00:00:00.000Z',
    v => v.data[0].issuer = 'http://machine.example.invalid', v => v.data[0].subject = 'alpha\u0000', v => v.data[0].subject = 's'.repeat(513),
    // A legacy row carried only the creation stamp; the generation is mandatory
    // and must be exactly 32 lowercase hex characters.
    v => delete v.data[0].grantId, v => v.data[0].grantId = null, v => v.data[0].grantId = 42,
    v => v.data[0].grantId = '', v => v.data[0].grantId = '0123456789abcdef', v => v.data[0].grantId = '0'.repeat(33),
    v => v.data[0].grantId = 'ABCDEF0123456789ABCDEF0123456789', v => v.data[0].grantId = 'g'.repeat(32),
    v => v.data[0].grantId = v.data[0].createdAt, v => v.data[0].grantId = 'a'.repeat(32) + '\n',
    v => v.page.limit = 0, v => v.page.limit = 101, v => v.page.limit = 3, v => v.page.nextCursor = '', v => v.page.nextCursor = 'bad cursor',
    v => v.page.nextCursor = 'x'.repeat(12289), v => v.page.nextCursor = encode('other', issuer, 'zeta'),
    v => v.page.nextCursor = Buffer.from(JSON.stringify(['changes', 1, 'sembom', issuer, 'zeta'])).toString('base64url'),
    v => v.page.nextCursor = Buffer.from(JSON.stringify(['publishers', 1, 'sembom', issuer, 'zeta'], null, 1)).toString('base64url'),
    v => v.page.nextCursor = encode('sembom', issuer, 'alpha'),
  ]) { const value = limited(); mutate(value); assert.throws(() => parseProjectPublisherPage(value)); }
  // A position is only valid on a full page, so a short page must not carry one.
  const short = page(); short.page.nextCursor = encode('sembom', issuer, 'build-bot');
  assert.throws(() => parseProjectPublisherPage(short));
});

test('cursor helper rejects other projects, other list kinds and non-canonical encodings', () => {
  const cursor = encode('sembom', issuer, 'build-bot');
  assert.deepEqual(publisherCursor('sembom', cursor), [issuer, 'build-bot']);
  assert.equal(publisherCursor('sembom', null), null);
  for (const value of ['bad cursor', cursor + '=', 'x'.repeat(12289), encode('other', issuer, 'build-bot'),
    Buffer.from(JSON.stringify(['changes', 1, 'sembom', issuer, 'build-bot'])).toString('base64url'),
    Buffer.from(JSON.stringify(['publishers', 1, 'sembom', issuer, 'build-bot'], null, 1)).toString('base64url'),
    Buffer.from(JSON.stringify(['publishers', 2, 'sembom', issuer, 'build-bot'])).toString('base64url'),
    Buffer.from(JSON.stringify(['publishers', 1, 'sembom', 'http://machine.example.invalid', 'build-bot'])).toString('base64url'),
    Buffer.from([0xff, 0xfe]).toString('base64url')])
    assert.throws(() => publisherCursor('sembom', value));
});

test('list request uses the owner endpoint, the canonical position and safe fetch policy', async () => {
  const calls = [], cursor = encode('sembom', issuer, 'alpha');
  const body = { projectId: 'sembom', data: ['build-bot', 'zeta'].map(subject => row(subject)),
    page: { limit: 2, nextCursor: encode('sembom', issuer, 'zeta') } };
  const client = new ApiClient({ fetchImpl: async (url, init) => { calls.push({ url, init }); return response(body); } });
  const loaded = await client.listPublishers('sembom', { limit: 2, cursor });
  assert.deepEqual(loaded.data.map(item => item.subject), ['build-bot', 'zeta']);
  assert.equal(calls[0].url, '/v1/projects/sembom/publishers?limit=2&cursor=' + encodeURIComponent(cursor));
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  for (const mutate of [
    v => v.projectId = 'other', v => v.page.limit = 24, v => v.data = [row('alpha')],
    v => v.page.nextCursor = cursor, v => v.page.nextCursor = encode('sembom', issuer, 'beta'),
  ]) { const value = structuredClone(body); mutate(value);
    await assert.rejects(new ApiClient({ fetchImpl: async () => response(value) }).listPublishers('sembom', { limit: 2, cursor }),
      error => error instanceof ApiError && error.kind === 'contract'); }
  for (const bad of ['bad cursor', encode('other', issuer, 'alpha'), cursor + '='])
    await assert.rejects(client.listPublishers('sembom', { cursor: bad }), error => error.kind === 'invalid_request');
  await assert.rejects(client.listPublishers('BAD', {}), error => error.kind === 'invalid_request');
  assert.equal(calls.length, 1);
  client.destroy();
});

test('permission writes send the exact closed bodies and surface the fixed conflict message', async () => {
  const calls = [];
  const client = new ApiClient({ fetchImpl: async (url, init) => {
    calls.push({ url, init }); const body = JSON.parse(init.body);
    return response(result({ granted: init.method === 'PUT', issuer: body.issuer, subject: body.subject }));
  } });
  await client.changePublisher('sembom', grant);
  await client.changePublisher('sembom', revoke);
  await client.changePublisher('sembom', { granted: false, issuer, subject: 'build-bot', expectedGrantId: null });
  assert.equal(calls[0].url, '/v1/projects/sembom/publishers');
  assert.deepEqual(JSON.parse(calls[0].init.body), { issuer, subject: grant.subject }); assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].init.body), { issuer, subject: grant.subject, expectedGrantId: revoke.expectedGrantId });
  assert.equal(calls[1].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[2].init.body), { issuer, subject: grant.subject, expectedGrantId: null });
  assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.cache, 'no-store');
  for (const invalid of [{ ...grant, issuer: 'http://machine.example.invalid' }, { ...grant, expectedGrantId: null },
    { granted: 'yes', issuer, subject: 'build-bot' }, { issuer, subject: 'build-bot' },
    // The previous timestamp CAS no longer matches the closed revoke shape.
    { granted: false, issuer, subject: 'build-bot', expectedCreatedAt: '2026-10-11T00:00:00.000Z' },
    { granted: false, issuer, subject: 'build-bot', expectedCreatedAt: null },
    { ...revoke, expectedGrantId: 'yesterday' }, { ...revoke, expectedGrantId: 'ABCDEF0123456789ABCDEF0123456789' },
    { ...revoke, expectedGrantId: revoke.expectedGrantId.slice(0, 31) }, { ...revoke, expectedGrantId: 1 },
    { ...grant, caller: 'asserted' }])
    await assert.rejects(client.changePublisher('sembom', invalid), error => error.kind === 'invalid_request');
  assert.equal(calls.length, 3);
  // A live permission requires both the generation and the creation stamp; a
  // response from the previous contract has no generation field at all.
  const legacyResult = result(grant); delete legacyResult.grantId;
  for (const extra of [{ projectId: 'other' }, { issuer: 'https://other.example.invalid' }, { subject: 'other' },
    { granted: false }, { createdAt: null }, { grantId: null }, { grantId: 'ABCDEF0123456789ABCDEF0123456789' }])
    await assert.rejects(new ApiClient({ fetchImpl: async () => response(result(grant, extra)) }).changePublisher('sembom', grant),
      error => error.kind === 'contract');
  await assert.rejects(new ApiClient({ fetchImpl: async () => response(legacyResult) }).changePublisher('sembom', grant),
    error => error.kind === 'contract');
  // A revoke response clears the generation together with the creation stamp.
  for (const extra of [{ grantId: gid('build-bot') }, { createdAt: '2026-10-11T00:00:00.000Z' }])
    await assert.rejects(new ApiClient({ fetchImpl: async () => response({ ...result(revoke), ...extra }) }).changePublisher('sembom', revoke),
      error => error.kind === 'contract');
  const live = await new ApiClient({ fetchImpl: async () => response(result(grant)) }).changePublisher('sembom', grant);
  assert.equal(live.grantId, gid('build-bot'));
  const conflict = new ApiClient({ fetchImpl: async () => failure(409, 'publisher_conflict') });
  await assert.rejects(conflict.changePublisher('sembom', revoke), error => error instanceof ApiError &&
    error.kind === 'publisher_conflict' && /최신 목록/.test(error.message) && !error.message.includes('private'));
  client.destroy(); conflict.destroy();
});

test('list keeps one page, aborts superseded reads and clears identities when access is denied', async () => {
  const urls = [], pending = defer();
  const client = new ApiClient({ fetchImpl: async url => {
    urls.push(url); return url.includes('cursor=') ? pending.promise : response(fullPage());
  } });
  const list = new PublisherList(client, 'sembom'); await list.refresh();
  assert.equal(list.state.data.data.length, 25);
  const next = list.next(); await tick();
  assert.equal(list.state.phase, 'loading'); assert.equal(list.state.data, null);
  await list.next(); assert.equal(urls.length, 2);
  pending.resolve(response(page(['zeta'], null, 25))); await next;
  assert.equal(list.state.pageNumber, 2); assert.deepEqual(list.state.data.data.map(item => item.subject), ['zeta']);
  await list.next(); assert.equal(urls.length, 2);
  await list.refresh(); assert.equal(list.state.pageNumber, 1); assert.equal(urls.length, 3); assert.ok(!urls[2].includes('cursor='));
  for (const status of [401, 403]) {
    let calls = 0;
    const denied = new ApiClient({ fetchImpl: async () => ++calls === 1 ? response(fullPage()) : failure(status, 'forbidden') });
    const locked = new PublisherList(denied, 'sembom'); await locked.refresh(); await locked.next();
    assert.equal(locked.state.denied, true); assert.equal(locked.state.data, null);
    assert.ok(!locked.state.message.includes('private server details'));
    await locked.retry(); assert.equal(calls, 2);
    locked.destroy(); denied.destroy();
  }
  const stale = defer(), fresh = defer(), signals = []; let reads = 0;
  const abortable = new ApiClient({ fetchImpl: async (url, init) => { signals.push(init.signal); return ++reads === 1 ? stale.promise : fresh.promise; } });
  const raced = new PublisherList(abortable, 'sembom');
  const older = raced.refresh(); await tick(); const newer = raced.refresh(); await tick();
  assert.equal(signals[0].aborted, true);
  fresh.resolve(response(page(['Z-next'], null, 25))); await newer;
  stale.resolve(response(page(['😀'], null, 25))); await older;
  assert.deepEqual(raced.state.data.data.map(item => item.subject), ['Z-next']);
  const disposed = new PublisherList(abortable, 'sembom'); const running = disposed.refresh(); await tick();
  disposed.destroy(); await running;
  assert.equal(disposed.state.data, null);
  list.destroy(); assert.equal(list.state.data, null); client.destroy(); abortable.destroy();
});

test('editor reviews one write, keeps a conflicted request, and locks on denied or unknown outcomes', async () => {
  const calls = [], pending = defer(), saved = [];
  const client = new ApiClient({ fetchImpl: async (url, init) => { calls.push(init); return pending.promise; } });
  const editor = new PublisherEditor(client, 'sembom', { onSaved: value => saved.push(value) });
  assert.equal(editor.prepare(grant), true); assert.equal(editor.state.phase, 'review'); assert.equal(calls.length, 0);
  assert.equal(editor.prepare({ granted: true, issuer: 'http://machine.example.invalid', subject: 'x' }), false);
  assert.equal(editor.state.phase, 'error'); assert.equal(editor.prepare(grant), true);
  const writing = editor.confirm(); await tick();
  await editor.confirm(); editor.cancel(); assert.equal(editor.prepare({ ...revoke, subject: 'other' }), false);
  assert.equal(editor.state.phase, 'saving'); assert.equal(calls.length, 1);
  pending.resolve(response(result())); await writing;
  assert.equal(saved.length, 1); assert.match(editor.state.message, /저장했어요/); assert.equal(editor.state.request, null);
  await editor.confirm(); assert.equal(calls.length, 1);
  // An idempotent ensure reports the permission that already existed instead of claiming a new write.
  const idempotent = new PublisherEditor(new ApiClient({ fetchImpl: async () => response(result(grant, { changed: false })) }), 'sembom');
  idempotent.prepare(grant); await idempotent.confirm();
  assert.match(idempotent.state.message, /이미/); idempotent.destroy();
  // A revocation carries the grant generation the operator saw in the list.
  const revoking = new PublisherEditor(new ApiClient({ fetchImpl: async () => response(result(revoke, { changed: false })) }), 'sembom');
  revoking.prepare(revoke); await revoking.confirm();
  assert.match(revoking.state.message, /이미 발행 권한이 없는/); revoking.destroy();
  const conflicted = new PublisherEditor(new ApiClient({ fetchImpl: async () => failure(409, 'publisher_conflict') }), 'sembom');
  conflicted.prepare(revoke); await conflicted.confirm();
  assert.equal(conflicted.state.phase, 'error'); assert.deepEqual(conflicted.state.request, revoke);
  assert.ok(!conflicted.state.message.includes('private'));
  // After re-reading the list the operator retries with the newest generation.
  assert.equal(conflicted.prepare({ ...revoke, expectedGrantId: gid('regranted') }), true); conflicted.destroy();
  for (const value of [failure(401, 'unauthorized'), failure(403, 'forbidden')]) {
    let lost = 0;
    const deniedEditor = new PublisherEditor(new ApiClient({ fetchImpl: async () => value }), 'sembom', { onAccessLost: () => { lost++; } });
    deniedEditor.prepare(grant); await deniedEditor.confirm();
    assert.equal(deniedEditor.state.phase, 'denied'); assert.equal(lost, 1); assert.equal(deniedEditor.state.request, null);
    assert.equal(deniedEditor.prepare(grant), false); deniedEditor.destroy();
  }
  let count = 0;
  const uncertainClient = new ApiClient({ fetchImpl: async () => {
    if (++count === 1) throw Error('private transport detail');
    return response(result(revoke));
  } });
  const uncertainEditor = new PublisherEditor(uncertainClient, 'sembom');
  const candidate = { ...revoke };
  uncertainEditor.prepare(candidate); candidate.subject = 'changed-outside'; await uncertainEditor.confirm();
  assert.equal(uncertainEditor.state.phase, 'uncertain'); assert.equal(uncertainEditor.state.request.subject, 'build-bot');
  assert.ok(!uncertainEditor.state.message.includes('private'));
  await uncertainEditor.confirm(); assert.equal(uncertainEditor.state.phase, 'success');
  uncertainEditor.destroy();
  const disposed = defer(); let signal;
  const pendingEditor = new PublisherEditor(new ApiClient({ fetchImpl: async (url, init) => { signal = init.signal; return disposed.promise; } }),
    'sembom', { onSaved: () => { throw Error('private UI failure'); } });
  pendingEditor.prepare(grant); const inflight = pendingEditor.confirm(); await tick(); pendingEditor.destroy();
  assert.equal(signal.aborted, true); disposed.resolve(response(result())); await inflight;
  assert.equal(pendingEditor.state.request, null); assert.equal(pendingEditor.prepare(grant), false);
  editor.destroy(); client.destroy();
});
