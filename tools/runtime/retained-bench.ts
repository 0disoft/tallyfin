import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { arch, cpus, platform } from 'node:os';
import { dimensionKey, localDate } from '@tallyfin/core';
import { collectorHarness } from './collector-harness.ts';
import { latency } from './collector-bench.ts';
import { seedRetainedFixture, RETAINED_PROJECTS, TOOLS } from './retained-fixture.ts';

export async function pace<T, R>(jobs: { offsetMs: number; value: T }[], windowMs: number, limit: number,
  run: (value: T, lagMs: number) => Promise<R>, signal: AbortSignal) {
  assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 16 && Number.isFinite(windowMs) && windowMs >= 0);
  assert.ok(jobs.length <= 10000 && jobs.every((job, index) => Number.isFinite(job.offsetMs) && job.offsetMs >= 0 &&
    job.offsetMs <= windowMs && (!index || jobs[index - 1]!.offsetMs <= job.offsetMs)));
  const pending = new Set<Promise<void>>(), results: R[] = new Array(jobs.length);
  const started = performance.now(); let failed = false, failure: unknown;
  try {
    for (const [index, job] of jobs.entries()) {
      signal.throwIfAborted(); if (failed) break;
      const wait = started + job.offsetMs - performance.now();
      if (wait > 0) await delay(wait, undefined, { signal });
      signal.throwIfAborted(); if (failed) break;
      // Fail explicitly instead of hiding overload by slowing the offered workload.
      if (pending.size >= limit) throw Error('paced-concurrency-limit');
      const lag = Math.max(0, performance.now() - started - job.offsetMs);
      const task = Promise.resolve().then(() => run(job.value, lag)).then(value => { results[index] = value; })
        .catch(error => { if (!failed) failure = error; failed = true; }).finally(() => { pending.delete(task); });
      pending.add(task);
    }
    if (!failed) {
      const remaining = windowMs - (performance.now() - started);
      if (remaining > 0) await delay(remaining, undefined, { signal });
    }
  } finally { await Promise.allSettled(pending); }
  if (failed) throw failure;
  signal.throwIfAborted(); return results;
}
type Job = { kind: 'write'; project: string; tool: typeof TOOLS[number]; body: string } |
  { kind: 'read'; project: string } | { kind: 'cleanup' };
type Observation = { kind: Job['kind']; ms: number; lagMs: number; status: number; accepted: number; duplicates: number };
type EventRow = { project_id: string; event_date: string; event_name: string; dimension_key: string; count: number };
type WorkflowRow = { project_id: string; cohort_date: string; dimension_key: string; started_count: number; succeeded_count: number; failed_count: number };
const root = fileURLToPath(new URL('../../', import.meta.url));

export async function runRetainedBench(signal: AbortSignal) {
  signal.throwIfAborted(); const now = Date.now(), today = localDate(now, 'Asia/Seoul');
  if (localDate(now + 180000, 'Asia/Seoul') !== today) throw Error('Start outside the three-minute local-midnight guard.');
  const parent = join(root, '.tmp/retained-bench'); await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, 'run-'));
  const { mf, principal, adminToken } = await collectorHarness(output); // Live Worker clock, unlike the short quota experiment.
  let phase = 'seed'; const observations: Observation[] = [];
  try {
    const db = await mf.getD1Database('DB'), fixture = await seedRetainedFixture(db, principal, now);
    const url = await mf.ready; assert.equal(url.hostname, '127.0.0.1');
    const eventRows = async (): Promise<EventRow[]> => (await db.prepare(`SELECT project_id,event_date,event_name,dimension_key,count FROM event_daily_counts
      WHERE event_date>=? ORDER BY project_id,event_date,event_name,dimension_key`).bind(fixture.oldest).all<EventRow>()).results;
    const workflowRows = async (): Promise<WorkflowRow[]> => (await db.prepare(`SELECT project_id,cohort_date,dimension_key,started_count,succeeded_count,failed_count FROM workflow_daily_counts
      WHERE cohort_date>=? ORDER BY project_id,cohort_date,dimension_key`).bind(fixture.oldest).all<WorkflowRow>()).results;
    const expectedEvents = await eventRows(), expectedWorkflows = await workflowRows();
    const eventMap = new Map(expectedEvents.map(row => [[row.project_id, row.event_date, row.event_name, row.dimension_key].join('|'), row]));
    const workflowMap = new Map(expectedWorkflows.map(row => [[row.project_id, row.cohort_date, row.dimension_key].join('|'), row]));
    const size = async () => {
      const tables = ['event_receipts', 'workflow_attempts', 'event_daily_counts', 'workflow_daily_counts'] as const;
      return Object.fromEntries(await Promise.all(tables.map(async table => [table, await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')])));
    };
    const seeded = await size();
    const windowMs = 120000, jobs: { offsetMs: number; value: Job }[] = [];
    const added = new Map(RETAINED_PROJECTS.map(id => [id, 0])); let previous: Job | undefined;
    for (let batch = 0; batch < 480; batch++) {
      const project = RETAINED_PROJECTS[batch % RETAINED_PROJECTS.length]!, tool = TOOLS[batch % TOOLS.length]!;
      const occurredAt = new Date(now).toISOString();
      const body = JSON.stringify({ schemaVersion: 1, source: 'browser', events: Array.from({ length: 10 }, () => {
        const attempt = { workflowId: 'calculation', attemptId: crypto.randomUUID(), startedAt: occurredAt };
        return ['input_start', 'calculation_success'].map(name => ({ eventId: crypto.randomUUID(), name, occurredAt, properties: { tool }, attempt }));
      }).flat() });
      const write: Job = batch % 12 === 11 ? previous! : { kind: 'write', project, tool, body };
      previous = write;
      jobs.push({ offsetMs: batch * 250, value: write }, { offsetMs: batch * 250 + 125, value: { kind: 'read', project } });
    }
    for (let index = 0; index < 24; index++) jobs.push({ offsetMs: index * 5000, value: { kind: 'cleanup' } });
    jobs.sort((a, b) => a.offsetMs - b.offsetMs);
    const worker = await mf.getWorker();
    if (!('scheduled' in worker) || typeof worker.scheduled !== 'function') throw Error('missing-scheduled-handler');
    const scheduled = worker.scheduled.bind(worker);
    const from = new Date(Date.parse(today + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
    const summary = (project: string) => `/v1/projects/${project}/summary?schemaVersion=1&from=${from}&to=${today}`;
    // Warm the real verifier before the offered load; all work still uses loopback HTTP.
    const warm = await fetch(new URL(summary(RETAINED_PROJECTS[0]!), url), { headers: { Authorization: `Bearer ${adminToken}` }, signal });
    assert.equal(warm.status, 200); await warm.arrayBuffer();
    phase = 'paced-http-and-cleanup'; const started = performance.now();
    let cleanupOverlappedHttp = 0, httpInFlight = 0;
    await pace(jobs, windowMs, 16, async (job, lagMs) => {
      const at = performance.now(); let status = 200, accepted = 0, duplicates = 0;
      if (job.kind === 'cleanup') {
        if (httpInFlight > 0) cleanupOverlappedHttp++;
        const outcome = await scheduled({ scheduledTime: Date.now(), cron: '* * * * *' });
        assert.equal(outcome.outcome, 'ok');
      } else {
        httpInFlight++;
        try {
          const path = job.kind === 'write' ? `/v1/projects/${job.project}/batches` : summary(job.project);
          const response = await fetch(new URL(path, url), { method: job.kind === 'write' ? 'POST' : 'GET',
            headers: job.kind === 'write' ? { 'Content-Type': 'application/json', Origin: 'https://sembom.example.invalid' } : { Authorization: `Bearer ${adminToken}` },
            ...(job.kind === 'write' ? { body: job.body } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
          status = response.status; assert.equal(status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
          const data = await response.json() as { accepted?: number; duplicates?: number; totalEvents?: number };
          if (job.kind === 'write') {
            accepted = data.accepted!; duplicates = data.duplicates!;
            assert.ok((accepted === 20 && duplicates === 0) || (accepted === 0 && duplicates === 20));
            if (accepted) {
              added.set(job.project, added.get(job.project)! + accepted);
              for (const name of ['input_start', 'calculation_success']) {
                const row = eventMap.get([job.project, today, name, dimensionKey({ tool: job.tool })].join('|')); assert.ok(row); row.count += 10;
              }
              const row = workflowMap.get([job.project, today, dimensionKey({ tool: job.tool })].join('|')); assert.ok(row);
              row.started_count += 10; row.succeeded_count += 10;
            }
          } else assert.ok(Number.isSafeInteger(data.totalEvents) && data.totalEvents! >= 0);
        } finally { httpInFlight--; }
      }
      const sample = { kind: job.kind, ms: performance.now() - at, lagMs, status, accepted, duplicates }; observations.push(sample); return sample;
    }, signal);
    const elapsedMs = performance.now() - started;
    phase = 'verify-retention-and-live-state'; assert.equal(localDate(Date.now(), 'Asia/Seoul'), today);
    assert.ok(cleanupOverlappedHttp > 0); assert.equal(observations.length, 984);
    assert.equal(observations.reduce((sum, s) => sum + s.accepted, 0), 8800);
    assert.equal(observations.reduce((sum, s) => sum + s.duplicates, 0), 800);
    assert.deepEqual(await eventRows(), expectedEvents); assert.deepEqual(await workflowRows(), expectedWorkflows);
    for (const project of RETAINED_PROJECTS) {
      assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM event_receipts WHERE project_id=? AND event_id GLOB '10000000-*' AND payload_hash=? AND received_at=? AND expires_at=?")
        .bind(project, 'a'.repeat(64), now - 86400000, now + 86400000).first('n'), fixture.size.receipts);
      assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM workflow_attempts WHERE project_id=? AND attempt_id GLOB '30000000-*' AND started_at=? AND expires_at=?")
        .bind(project, now - 86400000, now + 2 * 86400000).first('n'), fixture.size.attempts);
      assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_receipts WHERE project_id=?').bind(project).first('n'), fixture.size.receipts + added.get(project)!);
      assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM workflow_attempts WHERE project_id=?').bind(project).first('n'), fixture.size.attempts + added.get(project)! / 2);
      const response = await fetch(new URL(summary(project), url), { headers: { Authorization: `Bearer ${adminToken}` }, signal });
      assert.equal(response.status, 200); assert.equal((await response.json() as { totalEvents: number }).totalEvents, 30 * 18 * 100 + added.get(project)!);
    }
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_daily_counts WHERE event_date<?').bind(fixture.oldest).first('n'), 0);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM workflow_daily_counts WHERE cohort_date<?').bind(fixture.oldest).first('n'), 0);
    assert.equal(await db.prepare('SELECT revision FROM retention_cleanup_state').first('revision'), 24);
    const after = await size();
    const report = { schemaVersion: 'tallyfin.retained-bench/v1', local: true, syntheticData: true, verified: true,
      existingDatabasesAccessed: false, remoteChanges: false, workerClock: 'live', identityProvider: 'in-memory-ephemeral-jwks',
      node: process.version, host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length },
      miniflare: JSON.parse(await readFile(join(root, 'node_modules/miniflare/package.json'), 'utf8')).version,
      windowMs, elapsedMs, offeredHttpRequestsPerSecond: 8, maxInFlight: 16, seeded, after,
      accepted: 8800, duplicates: 800, cleanupInvocations: 24, cleanupOverlappedHttp,
      latency: Object.fromEntries(['write', 'read', 'cleanup'].map(kind => [kind, latency(observations.filter(s => s.kind === kind).map(s => s.ms))])),
      launchLag: latency(observations.map(s => s.lagMs)), observations };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' }); return { ...report, output };
  } catch {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ local: true, phase, verified: false, completed: observations.length, observations }), { flag: 'wx' });
    throw Error(`Retained benchmark failed during ${phase}. Inspect ${output}/failure.json.`);
  } finally { await mf.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('npm run bench:retained\nCreates synthetic retained/expired history for six projects and offers 8 HTTP requests/second for 120 seconds while invoking actual scheduled cleanup every 5 seconds. Local only, live clock, no URLs/secrets/target options. Reports in .tmp/retained-bench/. Not production capacity proof.');
  else if (args.length) { console.error('No options are accepted. Use --help.'); process.exitCode = 1; }
  else {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    runRetainedBench(AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]))
      .then(({ observations: _observations, ...report }) => console.log(JSON.stringify(report)))
      .catch(error => { console.error(error.message); process.exitCode = 1; })
      .finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  }
}
