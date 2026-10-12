import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRegistry, localDate } from '@tallyfin/core';
import { createTallyfinServer } from '../../packages/server/src/index.ts';
import { projectServerSchema } from '../server/schema.mjs';
import { collectorHarness } from './collector-harness.ts';
import { initialize } from '../provision/local.ts';
import { Provisioner } from '../provision/store.ts';
import { PublisherProvisioner } from '../provision/publishers.ts';

type Mode = 'before-commit' | 'after-commit' | 'denied';
type Observation = { mode: Mode; upstreamStatus: number | null; worker: number | null; responseLost: boolean };
const root = fileURLToPath(new URL('../../', import.meta.url));

/** Default Node SDK/fetch over real sockets. Only a new local synthetic environment is used. */
export async function verifyServerRecovery(signal: AbortSignal) {
  signal.throwIfAborted();
  const parent = join(root, '.tmp/server-recovery'); await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, 'run-'));
  const { mf, principal, tokens, collectorNames } = await collectorHarness(output, undefined, 3);
  const observations: Observation[] = [], pending = new Set<Promise<void>>();
  let phase = 'provision', mode: Mode = 'before-commit', faultPending = true, forwarded = 0;
  let bodies: string[] = [], relay: ReturnType<typeof createServer> | undefined;
  try {
    const db = await mf.getD1Database('DB'); await initialize(db, true);
    const raw = JSON.parse(await readFile(join(root, 'api/examples/funnel-registry.json'), 'utf8'));
    // A reviewed enum domain is the same set even when the terminal lists it differently.
    for (const event of raw.events) if (event.name === 'job_finished') event.properties.kind.values.reverse();
    const registry = validateRegistry({ ...raw, project: { ...raw.project, id: 'recovery-funnel' } });
    const provision = new Provisioner(db), publishers = new PublisherProvisioner(db);
    await provision.apply(await provision.plan('register', registry));
    await provision.apply(await provision.plan('grant', { projectId: registry.project.id, ...principal, role: 'owner' }));
    const identity = { projectId: registry.project.id, ...principal };
    await publishers.apply(await publishers.plan('publisher-grant', identity));
    const base = await mf.ready; assert.equal(base.hostname, '127.0.0.1');
    const path = `/v1/projects/${registry.project.id}/server-batches`;
    const handle = async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST' || request.url !== path) { response.writeHead(404); response.end(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 16384) { response.writeHead(413); response.end(); return; }
        chunks.push(bytes);
      }
      const body = Buffer.concat(chunks); bodies.push(createHash('sha256').update(body).digest('hex'));
      if (mode === 'before-commit' && faultPending) {
        faultPending = false; observations.push({ mode, upstreamStatus: null, worker: null, responseLost: false });
        response.writeHead(503, { 'Retry-After': '1', 'Cache-Control': 'no-store' }); response.end(); return;
      }
      const worker = forwarded++ % collectorNames.length;
      const upstream = await fetch(new URL(`/worker/${worker}${path}`, base), { method: 'POST', body,
        headers: { 'Content-Type': 'application/json', Authorization: request.headers.authorization ?? '' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
      assert.equal(upstream.headers.get('X-Tallyfin-Bench-Worker'), collectorNames[worker]);
      const reply = Buffer.from(await upstream.arrayBuffer()); assert.ok(reply.length <= 1024);
      const lost = mode === 'after-commit' && faultPending;
      observations.push({ mode, upstreamStatus: upstream.status, worker, responseLost: lost });
      if (lost) {
        assert.equal(upstream.status, 200); assert.deepEqual(JSON.parse(reply.toString()), { accepted: 2, duplicates: 0 });
        faultPending = false; response.destroy(); return;
      }
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' });
      response.end(reply);
    };
    relay = createServer((request, response) => {
      const task = handle(request, response).catch(() => { if (!response.destroyed) response.destroy(); }).finally(() => pending.delete(task));
      pending.add(task);
    });
    relay.requestTimeout = 15000; relay.headersTimeout = 15000;
    await new Promise<void>((resolve, reject) => { relay!.once('error', reject); relay!.listen(0, '127.0.0.1', resolve); });
    const endpoint = `http://127.0.0.1:${(relay.address() as AddressInfo).port}${path}`;
    const sdk = createTallyfinServer({ endpoint, allowLocalHttp: true, schema: projectServerSchema(registry),
      getToken: () => tokens.getPublisherToken(), requestTimeoutMs: 5000, retryBudgetMs: 15000 });
    const results = [];
    for (const fault of ['before-commit', 'after-commit'] as const) {
      signal.throwIfAborted(); phase = fault; mode = fault; faultPending = true; bodies = [];
      const occurredAt = new Date().toISOString(), link = { funnelId: 'conversion', runId: crypto.randomUUID(), startedAt: occurredAt };
      const browser = await fetch(new URL(`/worker/0/v1/projects/${registry.project.id}/batches`, base), { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: registry.allowedOrigins[0]! },
        body: JSON.stringify({ schemaVersion: 1, source: 'browser', events: ['file_selected', 'upload_finished'].map(name => ({ eventId: crypto.randomUUID(), name,
          occurredAt, properties: { kind: 'pdf' }, funnel: link })) }), signal });
      assert.equal(browser.status, 200); assert.deepEqual(await browser.json(), { accepted: 2, duplicates: 0 });
      const events = ['job_started', 'job_finished'].map(name => sdk.createEvent(name, { kind: 'pdf' }, { occurredAt, funnel: link }));
      const result = await sdk.send(events, { signal });
      assert.deepEqual(result, { status: 'delivered', accepted: fault === 'before-commit' ? 2 : 0, duplicates: fault === 'after-commit' ? 2 : 0, attempts: 2 });
      assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
      results.push({ mode: fault, ...result });
    }
    phase = 'verify-and-revoke';
    const snapshot = async () => JSON.stringify((await db.prepare('SELECT source,event_name,SUM(count) AS n FROM event_daily_counts GROUP BY source,event_name ORDER BY source,event_name').all()).results);
    const before = await snapshot();
    assert.deepEqual(JSON.parse(before), registry.events.map(event => ({ source: event.source, event_name: event.name, n: 2 }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.event_name.localeCompare(b.event_name)));
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_receipts').first('n'), 8);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM funnel_runs').first('n'), 2);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM funnel_runs WHERE json_array_length(step_times_json)=4 AND NOT EXISTS (SELECT 1 FROM json_each(step_times_json) WHERE type='null')").first('n'), 2);
    assert.deepEqual((await db.prepare('SELECT step_index,reached_count FROM funnel_daily_counts ORDER BY step_index').all()).results,
      [0, 1, 2, 3].map(step_index => ({ step_index, reached_count: 2 })));
    await publishers.apply(await publishers.plan('publisher-revoke', identity));
    mode = 'denied'; bodies = [];
    const denied = await sdk.send([sdk.createEvent('job_finished', { kind: 'pdf' })], { signal });
    assert.equal(denied.status, 'rejected'); assert.equal(denied.httpStatus, 403);
    assert.equal(denied.attempts, 1); assert.equal(denied.retryable, false);
    assert.equal(bodies.length, 1); assert.equal(await snapshot(), before);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_receipts').first('n'), 8);
    const today = localDate(Date.now(), registry.project.timeZone);
    for (const [worker, name] of collectorNames.entries()) {
      const response = await fetch(new URL(`/worker/${worker}/v1/projects/${registry.project.id}/funnels/conversion/daily?schemaVersion=1&from=${today}&to=${today}`, base),
        { headers: { Authorization: `Bearer ${await tokens.getAdminToken()}` }, signal });
      assert.equal(response.status, 200); assert.equal(response.headers.get('X-Tallyfin-Bench-Worker'), name);
      const data = await response.json() as { summary: { startedRuns: number; completedRuns: number; completionRate: number } };
      assert.equal(data.summary.startedRuns, 2); assert.equal(data.summary.completedRuns, 2); assert.equal(data.summary.completionRate, 100);
    }
    const afterCommit = observations.filter(row => row.mode === 'after-commit');
    assert.equal(afterCommit.length, 2); assert.notEqual(afterCommit[0]!.worker, afterCommit[1]!.worker);
    const report = { schemaVersion: 'tallyfin.server-recovery/v1', local: true, syntheticData: true, verified: true,
      defaultSdkFetch: true, workerCount: 3, existingDatabasesAccessed: false, remoteChanges: false,
      responseLoss: 'socket-closed-after-verified-commit', results, denied: { attempts: denied.attempts, httpStatus: 403 },
      receipts: 8, completedRuns: 2, unchangedAfterDenial: true, byteIdenticalRetries: true, observations };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' }); return { ...report, output };
  } catch {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ local: true, verified: false, phase, observations }), { flag: 'wx' });
    throw Error(`Server recovery verification failed during ${phase}. Inspect ${output}/failure.json.`);
  } finally {
    relay?.closeAllConnections();
    if (relay?.listening) await new Promise<void>(resolve => relay!.close(() => resolve()));
    await Promise.allSettled(pending); await mf.dispose();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('npm run verify:server-recovery\nReal Node SDK over loopback sockets: pre-commit 503, socket loss after commit, cross-worker duplicate retry and revoked publisher 403. Fresh synthetic D1 only. No target or credential options.');
  else if (args.length) { console.error('Only --help is accepted.'); process.exitCode = 1; }
  else {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    verifyServerRecovery(AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]))
      .then(report => console.log(JSON.stringify(report)))
      .catch(error => { console.error(error.message); process.exitCode = 1; })
      .finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  }
}
