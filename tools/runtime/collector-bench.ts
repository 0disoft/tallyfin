import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release, arch } from 'node:os';
import { validateRegistry } from '@tallyfin/core';
import { collectorHarness } from './collector-harness.ts';
import { initialize } from '../provision/local.ts';
import { Provisioner } from '../provision/store.ts';
import { PublisherProvisioner } from '../provision/publishers.ts';
import { benchmarkFailure } from './benchmark-failure.ts';

type Job = { kind: 'write' | 'read'; path: string; body?: string; origin?: string; publisher?: boolean };
type Sample = { kind: Job['kind']; status: number; ms: number; accepted: number; duplicates: number; total?: number };
export function latency(values: number[]) {
  assert.ok(values.length && values.every(value => Number.isFinite(value) && value >= 0));
  const ordered = [...values].sort((a, b) => a - b);
  const at = (p: number) => ordered[Math.ceil(ordered.length * p) - 1]!;
  return { samples: ordered.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: ordered.at(-1)! };
}
export async function pool<T, R>(jobs: T[], concurrency: number, run: (job: T) => Promise<R>): Promise<R[]> {
  assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 16);
  const output: R[] = new Array(jobs.length); let next = 0, failed = false;
  const lanes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (!failed && next < jobs.length) {
      const index = next++;
      try { output[index] = await run(jobs[index]!); } catch (error) { failed = true; throw error; }
    }
  }));
  const failure = lanes.find(lane => lane.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return output;
}
function stats(name: string, concurrency: number, samples: Sample[], elapsedMs: number) {
  const statuses: Record<string, number> = {};
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] ?? 0) + 1;
  return { name, concurrency, requests: samples.length, elapsedMs, requestsPerSecond: samples.length * 1000 / elapsedMs,
    statuses, accepted: samples.reduce((sum, sample) => sum + sample.accepted, 0),
    duplicates: samples.reduce((sum, sample) => sum + sample.duplicates, 0),
    write: samples.some(s => s.kind === 'write') ? latency(samples.filter(s => s.kind === 'write').map(s => s.ms)) : null,
    read: samples.some(s => s.kind === 'read') ? latency(samples.filter(s => s.kind === 'read').map(s => s.ms)) : null };
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const example = async (name: string) => JSON.parse(await readFile(new URL(`../../api/examples/${name}.json`, import.meta.url), 'utf8'));

/** Opt-in bounded local HTTP experiment. Never accepts a URL, credentials or an existing DB. */
export async function runCollectorBench(signal: AbortSignal = new AbortController().signal) {
  signal.throwIfAborted();
  const outputRoot = join(root, '.tmp/collector-bench'); await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(join(outputRoot, 'run-'));
  const now = Date.now(), occurredAt = new Date(now).toISOString();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Frozen Worker clock for deterministic quota windows; HTTP timing remains monotonic/real.
  const { mf, principal, adminToken, publisherToken } = await collectorHarness(output, now);
  let phase = 'initialize'; const phases: ReturnType<typeof stats>[] = [];
  const failures: ({ phase: string; kind: Job['kind']; status: number; startedAt: number; elapsedMs: number } & ReturnType<typeof benchmarkFailure>)[] = [];
  const observations: { phase: string; samples: Sample[] }[] = [];
  try {
    signal.throwIfAborted(); const db = await mf.getD1Database('DB'); await initialize(db, true);
    const browser = validateRegistry(await example('registry')), funnel = validateRegistry(await example('funnel-registry'));
    const quota = validateRegistry({ ...funnel, project: { ...funnel.project, id: 'quota-probe' }, limits: { ...funnel.limits, requestsPerMinute: 12 } });
    const provision = new Provisioner(db), publishers = new PublisherProvisioner(db);
    for (const registry of [browser, funnel, quota]) {
      await provision.apply(await provision.plan('register', registry), now);
      await provision.apply(await provision.plan('grant', { projectId: registry.project.id, ...principal, role: 'owner' }), now);
      if (registry !== browser) await publishers.apply(await publishers.plan('publisher-grant', { projectId: registry.project.id, ...principal }), now);
    }
    const url = await mf.ready; assert.equal(url.hostname, '127.0.0.1');
    const request = async (job: Job): Promise<Sample> => {
      signal.throwIfAborted(); const start = performance.now(), startedAt = Date.now();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (job.origin) headers.Origin = job.origin;
      if (job.kind === 'read' || job.publisher) headers.Authorization = `Bearer ${job.publisher ? publisherToken : adminToken}`;
      const response = await fetch(new URL(job.path, url), { method: job.kind === 'write' ? 'POST' : 'GET', headers,
        ...(job.body === undefined ? {} : { body: job.body }), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      let body: { accepted?: number; duplicates?: number; totalEvents?: number; error?: { code?: string } };
      try { body = await response.json() as typeof body; }
      catch {
        failures.push({ phase, kind: job.kind, status: response.status, startedAt, elapsedMs: performance.now() - start });
        throw new Error('Invalid benchmark response');
      }
      if (response.status >= 400) failures.push({ phase, kind: job.kind, status: response.status, startedAt,
        elapsedMs: performance.now() - start, ...benchmarkFailure(body, response.headers.get('Retry-After')) });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      if (response.status === 200 && job.kind === 'write') {
        assert.ok(Number.isSafeInteger(body.accepted) && Number.isSafeInteger(body.duplicates));
        assert.equal(body.accepted! + body.duplicates!, JSON.parse(job.body!).events.length);
      }
      if (response.status === 200 && job.kind === 'read') assert.ok(Number.isSafeInteger(body.totalEvents) && body.totalEvents! >= 0);
      if (response.status === 429) { assert.equal(body.error?.code, 'quota_exceeded'); assert.ok(Number(response.headers.get('Retry-After')) >= 1); }
      return { kind: job.kind, status: response.status, ms: performance.now() - start, accepted: body.accepted ?? 0,
        duplicates: body.duplicates ?? 0, ...(body.totalEvents === undefined ? {} : { total: body.totalEvents }) };
    };
    const read = (project: string, source = 'browser'): Job => ({ kind: 'read', path: `/v1/projects/${project}/summary?schemaVersion=1&from=${date}&to=${date}&source=${source}` });
    const write = (project: string, events: unknown[], server = false): Job => ({ kind: 'write',
      path: `/v1/projects/${project}/${server ? 'server-batches' : 'batches'}`,
      body: JSON.stringify({ schemaVersion: 1, source: server ? 'server' : 'browser', events }),
      ...(server ? { publisher: true } : { origin: project === 'sembom' ? browser.allowedOrigins[0]! : funnel.allowedOrigins[0]! }) });
    const simple = (name: string, properties: Record<string, string>) => ({ eventId: crypto.randomUUID(), name, occurredAt, properties });
    const run = async (name: string, concurrency: number, jobs: Job[]) => {
      phase = name; const started = performance.now(); const samples = await pool(jobs, concurrency, request);
      const result = stats(name, concurrency, samples, performance.now() - started); phases.push(result);
      observations.push({ phase: name, samples });
      return { samples, result };
    };
    // Warm verifier and runtime outside the measured stages; no ingestion or quota is consumed.
    assert.equal((await request(read('sembom'))).total, 0);
    for (const concurrency of [1, 4, 8, 16]) {
      const jobs: Job[] = [];
      for (let batch = 0; batch < 12; batch++) {
        const events = Array.from({ length: 10 }, () => {
          const attempt = { workflowId: 'calculation', attemptId: crypto.randomUUID(), startedAt: occurredAt };
          return ['input_start', 'calculation_success'].map(name => ({ ...simple(name, { tool: ['grade', 'loan', 'timer'][batch % 3]! }), attempt }));
        }).flat();
        jobs.push(write('sembom', events)); if (batch % 2 === 0) jobs.push(read('sembom'));
      }
      const result = await run(`workflow-and-summary-${concurrency}`, concurrency, jobs);
      assert.ok(result.samples.every(s => s.status === 200)); assert.equal(result.result.accepted, 240);
      assert.equal(result.result.duplicates, 0);
    }
    const repeated = write('sembom', Array.from({ length: 20 }, () => simple('tool_view', { tool: 'loan' })));
    const duplicate = await run('concurrent-identical-replay', 16, Array.from({ length: 16 }, () => repeated));
    assert.ok(duplicate.samples.every(s => s.status === 200)); assert.equal(duplicate.result.accepted, 20);
    assert.equal(duplicate.result.duplicates, 300);
    const funnelJobs: Job[] = [];
    for (let index = 0; index < 24; index++) {
      const runId = crypto.randomUUID();
      for (const stepIndex of [3, 0, 2, 1]) {
        const step = funnel.funnels![0]!.steps[stepIndex]!;
        funnelJobs.push(write('modufile', [{ ...simple(step.eventName, { kind: index % 2 ? 'pdf' : 'image' }),
          funnel: { funnelId: funnel.funnels![0]!.id, runId, startedAt: occurredAt } }], step.source === 'server'));
      }
      if (index % 4 === 0) funnelJobs.push(read('modufile', 'server'));
    }
    const mixed = await run('mixed-source-funnels-and-summary', 8, funnelJobs);
    assert.ok(mixed.samples.every(s => s.status === 200)); assert.equal(mixed.result.accepted, 96);
    const quotaJobs = Array.from({ length: 24 }, (_, index) => write('quota-probe',
      [simple(index % 2 ? 'job_started' : 'file_selected', { kind: 'pdf' })], Boolean(index % 2)));
    const limited = await run('shared-browser-server-quota', 8, quotaJobs);
    assert.equal(limited.result.statuses['200'], 12); assert.equal(limited.result.statuses['429'], 12);
    assert.equal(limited.result.accepted, 12);
    const isolation = await run('other-projects-after-quota', 2, [write('sembom', [simple('tool_view', { tool: 'loan' })]),
      write('modufile', [simple('file_selected', { kind: 'pdf' })])]);
    assert.ok(isolation.samples.every(s => s.status === 200)); assert.equal(isolation.result.accepted, 2);
    phase = 'verify-final-summary';
    assert.equal((await request(read('sembom'))).total, 981);
    assert.equal((await request(read('modufile'))).total, 49);
    assert.equal((await request(read('modufile', 'server'))).total, 48);
    phase = 'verify-final-counts';
    const counts = await db.prepare('SELECT project_id, SUM(count) AS count FROM event_daily_counts GROUP BY project_id ORDER BY project_id').all();
    assert.deepEqual(counts.results, [{ project_id: 'modufile', count: 97 }, { project_id: 'quota-probe', count: 12 }, { project_id: 'sembom', count: 981 }]);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_receipts').first('n'), 1090);
    phase = 'verify-final-workflows';
    const workflows = await db.prepare('SELECT SUM(started_count) AS started, SUM(succeeded_count) AS succeeded, SUM(failed_count) AS failed FROM workflow_daily_counts').first();
    assert.deepEqual(workflows, { started: 480, succeeded: 480, failed: 0 });
    phase = 'verify-final-funnels';
    const funnels = await db.prepare('SELECT step_index, SUM(reached_count) AS reached FROM funnel_daily_counts WHERE project_id=? GROUP BY step_index ORDER BY step_index').bind('modufile').all();
    assert.deepEqual(funnels.results, [0, 1, 2, 3].map(step_index => ({ step_index, reached: 24 })));
    phase = 'verify-final-admission';
    const admission = await db.prepare("SELECT request_count, json_extract(rejections_json, '$.minute_limit.count') AS rejected FROM ingest_minute_usage WHERE project_id=?")
      .bind('quota-probe').first();
    assert.deepEqual(admission, { request_count: 24, rejected: 12 });
    const report = { schemaVersion: 'tallyfin.collector-bench/v1', local: true, syntheticData: true, verified: true,
      remoteChanges: false, existingDatabasesAccessed: false, transport: 'loopback-http', workerClock: 'frozen',
      identityProvider: 'in-memory-ephemeral-jwks', node: process.version,
      host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length },
      miniflare: JSON.parse(await readFile(join(root, 'node_modules/miniflare/package.json'), 'utf8')).version,
      phases, observations, verifiedCounts: { receipts: 1090, workflowStarted: 480, workflowSucceeded: 480, completedFunnels: 24, quotaAccepted: 12, quotaRejected: 12 } };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    return { ...report, output };
  } catch {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ local: true, phase, verified: false, phases, failures }, null, 2), { flag: 'wx' });
    throw new Error(`Local collector benchmark failed during ${phase}. Inspect ${output}/failure.json.`);
  } finally { await mf.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('npm run bench:collector\nBounded loopback HTTP workload against a new synthetic local D1. Tests workflow writes, authenticated reads, duplicate races, mixed-source funnels and quota isolation. Worker clock is frozen; timing is real. No URLs, secrets or target options. Reports stay in .tmp/collector-bench/. Not a production throughput or capacity test.');
  else if (args.length) { console.error('No options are accepted. Use --help.'); process.exitCode = 1; }
  else {
    const controller = new AbortController(); const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    runCollectorBench(AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]))
      .then(({ observations: _observations, ...report }) => console.log(JSON.stringify(report)))
      .catch(error => { console.error(error.message); process.exitCode = 1; })
      .finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  }
}
