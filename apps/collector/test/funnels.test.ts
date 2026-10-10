import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import { example, migrationStatements } from '../../../packages/storage-d1/test/helpers.ts';
import { createTallyfinServer } from '../../../packages/server/src/index.ts';
import { projectServerSchema } from '../../../tools/server/schema.mjs';

test('native Worker joins public browser milestones and authenticated server milestones through real D1', async () => {
  const registry = example('funnel-registry'), issuer = 'https://machine.example.invalid', subject = crypto.randomUUID();
  // Ephemeral signing keys are confined to this test; no provider or production credential is configured.
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'ephemeral', alg: 'RS256' }] };
  const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
    contents: `import worker from './apps/collector/src/runtime.ts';
      globalThis.fetch = async () => Response.json(${JSON.stringify(jwks)}); export default worker;` },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023' });
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'ephemeral', typ: 'at+jwt' })
    .setIssuer(issuer).setAudience('server-events').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const producer = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
    contents: `import { createTallyfinServer } from './packages/server/src/index.ts';
      export default { async fetch(request, env) {
        const raw = await request.json();
        const client = createTallyfinServer({endpoint: 'https://collector.example.invalid/v1/projects/${registry.project.id}/server-batches',
          schema: ${JSON.stringify(projectServerSchema(registry))}, getToken: () => env.SIGNED_TEST_TOKEN});
        const event = client.createEvent(raw.name, raw.properties, {eventId: raw.eventId, occurredAt: raw.occurredAt, funnel: raw.funnel});
        return Response.json(await client.send([event]));
      }};` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2023', metafile: true });
  assert.ok(Object.keys(producer.metafile!.inputs).every(path => !/node_modules|packages\/(?:core|storage-d1|browser)/.test(path.replaceAll('\\', '/'))));
  const mf = new Miniflare({ workers: [
    { name: 'collector', modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
      bindings: { ...DEFAULT_SETTINGS, PUBLISHER_AUTH_MODE: 'oidc', PUBLISHER_OIDC_ISSUER: issuer,
        PUBLISHER_OIDC_AUDIENCE: 'server-events', PUBLISHER_OIDC_JWKS_URI: issuer + '/jwks' }, d1Databases: { DB: 'funnel-http' } },
    { name: 'producer', modules: true, script: producer.outputFiles[0]!.text, compatibilityDate: '2026-08-06',
      bindings: { SIGNED_TEST_TOKEN: token }, outboundService: 'collector' },
  ], log: new Log(LogLevel.NONE) });
  try {
    const db = await mf.getD1Database('DB', 'collector'), started = Date.now() - 5000, runId = crypto.randomUUID();
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await db.prepare(`INSERT INTO projects (id,name,status,time_zone,allowed_origins_json,requests_per_minute,new_receipts_per_utc_day,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(registry.project.id, registry.project.name, 'active', registry.project.timeZone,
        JSON.stringify(registry.allowedOrigins), 120, 100000, started).run();
    await db.prepare("INSERT INTO project_schemas VALUES (?,1,'active',?,?,NULL)")
      .bind(registry.project.id, JSON.stringify({ events: registry.events, workflows: registry.workflows, funnels: registry.funnels }), started).run();
    const bodies = registry.funnels[0].steps.map((step: { source: string; eventName: string }, index: number) => ({
      schemaVersion: 1, source: step.source, events: [{ eventId: crypto.randomUUID(), name: step.eventName,
        occurredAt: new Date(started + index * 1000).toISOString(), properties: { kind: 'pdf' },
        funnel: { funnelId: registry.funnels[0].id, runId, startedAt: new Date(started).toISOString() } }],
    }));
    const send = (body: typeof bodies[number], headers: Record<string, string> = {}, forceBrowser = false) => {
      const browser = forceBrowser || body.source === 'browser';
      return mf.dispatchFetch(`https://collector.example.invalid/v1/projects/${registry.project.id}/${browser ? 'batches' : 'server-batches'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(browser ? { Origin: registry.allowedOrigins[0] } : {}), ...headers },
        body: JSON.stringify(body),
      });
    };
    const count = (table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>('n');
    const stages = async () => (await db.prepare('SELECT step_index,reached_count FROM funnel_daily_counts ORDER BY step_index').all()).results;
    assert.equal((await send(bodies[3], { Origin: registry.allowedOrigins[0] })).status, 401);
    assert.equal((await send(bodies[3], { Authorization: 'Bearer ' + token })).status, 403);
    assert.equal(await count('event_receipts'), 0); assert.equal(await count('funnel_runs'), 0);
    await db.prepare('INSERT INTO project_publishers VALUES (?,?,?,?)').bind(registry.project.id, issuer, subject, started).run();
    let loseResponse = true, elapsed = 0;
    const sdk = createTallyfinServer({ endpoint: `https://collector.example.invalid/v1/projects/${registry.project.id}/server-batches`,
      schema: projectServerSchema(registry), getToken: () => token }, {
      now: () => Date.now(), monotonicNow: () => elapsed, uuid: () => crypto.randomUUID(), wait: async ms => { elapsed += ms; },
      fetch: async (url, init) => {
        const response = await mf.dispatchFetch(String(url), init as any);
        if (loseResponse) { loseResponse = false; await response.arrayBuffer(); throw Error('response lost after commit'); }
        return response as unknown as Response;
      },
    });
    assert.equal((await send(bodies[3], {}, true)).status, 400);
    assert.equal((await send({ ...bodies[3], source: 'browser' }, {}, true)).status, 422);
    assert.equal((await send(bodies[0], { Origin: 'https://evil.invalid' })).status, 403);
    for (const index of [3, 0, 2, 1]) {
      if (bodies[index].source === 'server') {
        const raw = bodies[index].events[0], event = sdk.createEvent(raw.name, raw.properties,
          { eventId: raw.eventId, occurredAt: raw.occurredAt, funnel: raw.funnel });
        assert.deepEqual(await sdk.send([event]), { status: 'delivered', accepted: index === 3 ? 0 : 1,
          duplicates: index === 3 ? 1 : 0, attempts: index === 3 ? 2 : 1 });
      } else {
        const response = await send(bodies[index]);
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: 1, duplicates: 0 });
      }
      if (index === 3) assert.deepEqual(await stages(), []);
      if (index === 2) assert.deepEqual(await stages(), [{ step_index: 0, reached_count: 1 }]);
    }
    assert.deepEqual(await stages(), Array.from({ length: 4 }, (_, step_index) => ({ step_index, reached_count: 1 })));
    const native = await mf.getWorker('producer');
    assert.deepEqual(await (await native.fetch('https://producer.example.invalid/run', { method: 'POST',
      body: JSON.stringify(bodies[3].events[0]) })).json(), { status: 'delivered', accepted: 0, duplicates: 1, attempts: 1 });
    assert.deepEqual(await (await send(bodies[3], { Authorization: 'Bearer ' + token })).json(), { accepted: 0, duplicates: 1 });
    const conflict = structuredClone(bodies[1]); conflict.events[0].eventId = crypto.randomUUID(); conflict.events[0].properties.kind = 'image';
    assert.equal((await send(conflict)).status, 409);
    await db.prepare('DELETE FROM project_publishers').run();
    const revoked = await (await native.fetch('https://producer.example.invalid/run', { method: 'POST',
      body: JSON.stringify(bodies[3].events[0]) })).json() as any;
    assert.equal(revoked.status, 'rejected'); assert.equal(revoked.httpStatus, 403); assert.equal(revoked.attempts, 1);
    assert.equal((await send(bodies[3], { Authorization: 'Bearer ' + token })).status, 403);
    assert.equal(await count('event_receipts'), 4); assert.equal(await count('funnel_runs'), 1);
    assert.equal(await count('workflow_attempts'), 0);
    assert.equal(await db.prepare('SELECT sum(count) AS n FROM event_daily_counts').first('n'), 4);
  } finally { await mf.dispose(); }
});
