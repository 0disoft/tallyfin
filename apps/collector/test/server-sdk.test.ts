import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { createJobAnalytics, jobSchema } from '../../../examples/server/job-analytics.ts';
import { projectServerSchema } from '../../../tools/server/schema.mjs';
import { PublisherProvisioner } from '../../../tools/provision/publishers.ts';
import { Provisioner } from '../../../tools/provision/store.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import { createTallyfinServer } from '../../../packages/server/src/index.ts';
import { example, migrationStatements } from '../../../packages/storage-d1/test/helpers.ts';

test('server projection includes only reviewed server rules; browser-only or invalid definitions cannot be projected', () => {
  assert.deepEqual(projectServerSchema(example('job-registry')), jobSchema);
  assert.throws(() => projectServerSchema(example('registry')), /server event/);
  const invalid = example('job-registry'); invalid.events[1].properties.outcome.values.push('free text');
  assert.throws(() => projectServerSchema(invalid));
});

test('Node SDK and native Worker SDK publish signed events through real D1; response loss, conflict and revoked permission remain safe', async () => {
  const issuer = 'https://machine.example.invalid'; const subject = crypto.randomUUID();
  // Test-only keys and JWTs stay in memory; no real provider or credential is configured.
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral', alg: 'RS256' }] };
  const sign = (audience = 'server-events') => new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' }).setIssuer(issuer).setAudience(audience)
    .setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const collector = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import worker from './apps/collector/src/runtime.ts';
    globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)});
    let redirectedRequests = 0;
    export default { fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (path === '/v1/projects/redirect/server-batches') return Response.redirect('https://untrusted.example.invalid/token-sink', 302);
      if (path === '/token-sink') { redirectedRequests++; return Response.json({accepted: 1, duplicates: 0}); }
      if (path === '/redirect-probe') return Response.json({redirectedRequests});
      return worker.fetch(request, env, ctx);
    }};` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const producer = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { createJobAnalytics } from './examples/server/job-analytics.ts';
    export default { async fetch(request, env) {
      const project = new URL(request.url).pathname === '/redirect' ? 'redirect' : 'jobs';
      const client = createJobAnalytics('https://collector.example.invalid/v1/projects/' + project + '/server-batches', () => env.SIGNED_TEST_TOKEN);
      const event = client.createEvent('job_finished', {outcome: 'success', retried: false});
      const result = await client.send([event], {signal: request.signal});
      return Response.json({result, eventId: event.eventId});
    }};` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023', metafile: true });
  assert.ok(Object.keys(producer.metafile!.inputs).every(path => !/node_modules|packages\/(?:core|storage-d1|browser)/.test(path.replaceAll('\\', '/'))));
  const mf = new Miniflare({ workers: [
    { name: 'collector', modules: true, script: collector.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
      bindings: { ...DEFAULT_SETTINGS, PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: issuer,
        PUBLISHER_OIDC_AUDIENCE: 'server-events', PUBLISHER_OIDC_JWKS_URI: issuer + '/jwks' },
      d1Databases: { DB: 'server-sdk-integration' } },
    { name: 'producer', modules: true, script: producer.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
      bindings: { SIGNED_TEST_TOKEN: await sign() }, outboundService: 'collector' },
  ], log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB', 'collector');
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    const operator = new Provisioner(db);
    await operator.apply(await operator.plan('register', example('job-registry')));
    const publishers = new PublisherProvisioner(db);
    const identity = { projectId: 'jobs', issuer, subject };
    await publishers.apply(await publishers.plan('publisher-grant', identity));
    const endpoint = 'https://collector.example.invalid/v1/projects/jobs/server-batches';
    let lose = true; const bodies: string[] = []; let tokens = 0; let elapsed = 0;
    const node = createJobAnalytics(endpoint, () => { tokens++; return sign(); }, {
      now: () => Date.now(), monotonicNow: () => elapsed, uuid: () => crypto.randomUUID(),
      wait: async ms => { elapsed += ms; },
      fetch: async (url, init) => {
        bodies.push(String(init!.body));
        const response = await mf.dispatchFetch(String(url), {
          method: init!.method, headers: init!.headers, body: String(init!.body),
        });
        const responseBody = await response.arrayBuffer();
        if (lose) { lose = false; throw Error('Simulated lost response after committed write'); }
        return new Response(responseBody, { status: response.status, headers: [...response.headers] });
      },
    });
    const event = node.createEvent('job_finished', { outcome: 'success', retried: false });
    assert.deepEqual(await node.send([event]), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 2 });
    assert.equal(bodies[0], bodies[1]); assert.equal(tokens, 2);
    assert.equal(await db.prepare("SELECT sum(count) AS n FROM event_daily_counts WHERE source='server'").first('n'), 1);
    assert.equal(await db.prepare('SELECT new_receipts AS n FROM ingest_daily_usage').first('n'), 1);
    const restored = node.createEvent('job_finished', event.properties, { eventId: event.eventId, occurredAt: event.occurredAt });
    assert.deepEqual(await node.send([restored]), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 1 });
    const conflict = node.createEvent('job_finished', { outcome: 'failure', retried: false }, { eventId: event.eventId, occurredAt: event.occurredAt });
    const denied = await node.send([conflict]); assert.equal(denied.status, 'rejected');
    assert.equal(denied.status !== 'delivered' && denied.httpStatus, 409); assert.equal(denied.attempts, 1);
    const worker = await mf.getWorker('producer');
    const response = await worker.fetch('https://producer.example.invalid/run');
    const native = await response.json() as any;
    assert.deepEqual(native.result, { status: 'delivered', accepted: 1, duplicates: 0, attempts: 1 });
    const redirect = await (await worker.fetch('https://producer.example.invalid/redirect')).json() as any;
    assert.deepEqual(redirect.result, { status: 'unavailable', reason: 'invalid_response', httpStatus: 302, retryable: true, attempts: 1 });
    const probe = await (await mf.dispatchFetch('https://collector.example.invalid/redirect-probe')).json() as any;
    assert.equal(probe.redirectedRequests, 0);
    assert.equal(await db.prepare("SELECT sum(count) AS n FROM event_daily_counts WHERE source='server'").first('n'), 2);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM workflow_attempts').first('n'), 0);
    // Exercise Node's default fetch as well as the response-loss transport above.
    const relay = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const received = await mf.dispatchFetch('https://collector.example.invalid' + request.url, {
          method: 'POST', body: Buffer.concat(chunks), headers: {
            'Content-Type': 'application/json', Authorization: request.headers.authorization ?? '',
          }, redirect: 'manual',
        });
        response.writeHead(received.status, Object.fromEntries(received.headers));
        response.end(Buffer.from(await received.arrayBuffer()));
      } catch { response.writeHead(502); response.end(); }
    });
    try {
      await new Promise<void>(resolve => relay.listen(0, '127.0.0.1', resolve));
      const base = 'http://127.0.0.1:' + (relay.address() as AddressInfo).port;
      const options = { schema: jobSchema, getToken: () => sign(), allowLocalHttp: true };
      const direct = createTallyfinServer({ ...options, endpoint: base + '/v1/projects/jobs/server-batches' });
      const directEvent = direct.createEvent('job_finished', { outcome: 'success' });
      assert.deepEqual(await direct.send([directEvent]), { status: 'delivered', accepted: 1, duplicates: 0, attempts: 1 });
      const redirectClient = createTallyfinServer({ ...options, endpoint: base + '/v1/projects/redirect/server-batches' });
      assert.deepEqual(await redirectClient.send([directEvent]), redirect.result);
      assert.equal((await (await mf.dispatchFetch('https://collector.example.invalid/redirect-probe')).json() as any).redirectedRequests, 0);
      assert.equal(await db.prepare("SELECT sum(count) AS n FROM event_daily_counts WHERE source='server'").first('n'), 3);
      await publishers.apply(await publishers.plan('publisher-revoke', identity));
      const revoked = await direct.send([directEvent]); assert.equal(revoked.status, 'rejected');
      assert.equal(revoked.status !== 'delivered' && revoked.httpStatus, 403); assert.equal(revoked.attempts, 1);
      const revokedNative = await (await worker.fetch('https://producer.example.invalid/run')).json() as any;
      assert.equal(revokedNative.result.httpStatus, 403); assert.equal(revokedNative.result.attempts, 1);
      assert.equal(await db.prepare('SELECT count(*) AS n FROM event_receipts').first('n'), 3);
    } finally {
      relay.closeAllConnections(); await new Promise<void>((resolve, reject) => relay.close(error => error ? reject(error) : resolve()));
    }
  } finally { await mf.dispose(); }
});
