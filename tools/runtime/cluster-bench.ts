import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { dimensionKey, localDate, validateRegistry } from '@tallyfin/core';
import { collectorHarness } from './collector-harness.ts';
import { seedRetainedFixture, RETAINED_PROJECTS, TOOLS } from './retained-fixture.ts';
import { pace } from './retained-bench.ts';
import { latency } from './collector-bench.ts';
import { Provisioner } from '../provision/store.ts';
import { PublisherProvisioner } from '../provision/publishers.ts';

type Job = { kind: 'workflow' | 'browser-funnel' | 'server-funnel'; worker: number; project: string; body: string; tool?: string } |
  { kind: 'summary' | 'funnel'; worker: number; project: string } | { kind: 'cleanup'; worker: number };
type Sample = { kind: Job['kind']; worker: number; ms: number; lagMs: number; status: number; accepted: number; duplicates: number };
type EventRow = { project_id: string; event_date: string; event_name: string; dimension_key: string; count: number };
type FlowRow = { project_id: string; cohort_date: string; dimension_key: string; started_count: number; succeeded_count: number; failed_count: number };
const root = fileURLToPath(new URL('../../', import.meta.url));
const WINDOW_MS = 120000, WAVES = 60, WORKERS = 3;
const TABLES = ['event_receipts', 'workflow_attempts', 'event_daily_counts', 'workflow_daily_counts', 'funnel_runs', 'funnel_daily_counts'] as const;

/** Three independent collector isolates, one fresh D1, exact workload; no existing or remote target. */
export async function runClusterBench(signal: AbortSignal) {
  signal.throwIfAborted(); const now = Date.now(), today = localDate(now, 'Asia/Seoul');
  if (localDate(now + 180000, 'Asia/Seoul') !== today) throw Error('Start outside the three-minute local-midnight guard.');
  const parent = join(root, '.tmp/cluster-bench'); await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, 'run-'));
  const { mf, principal, adminToken, publisherToken, collectorNames } = await collectorHarness(output, undefined, WORKERS);
  let phase = 'seed'; const observations: Sample[] = [];
  try {
    const db = await mf.getD1Database('DB');
    const fixture = await seedRetainedFixture(db, principal, now, { receipts: 10000, attempts: 10000, expired: 1200, days: 90 });
    phase = 'provision-funnel';
    const funnel = validateRegistry(JSON.parse(await readFile(join(root, 'api/examples/funnel-registry.json'), 'utf8')));
    const provision = new Provisioner(db), publishers = new PublisherProvisioner(db);
    const configured = validateRegistry({ ...funnel, project: { ...funnel.project, id: 'cluster-funnel' }, limits: { ...funnel.limits, requestsPerMinute: 600 } });
    await provision.apply(await provision.plan('register', configured), now);
    await provision.apply(await provision.plan('grant', { projectId: configured.project.id, ...principal, role: 'owner' }), now);
    await publishers.apply(await publishers.plan('publisher-grant', { projectId: configured.project.id, ...principal }), now);
    const size = async () => Object.fromEntries(await Promise.all(TABLES.map(async table => [table, await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')])));
    const eventRows = async (): Promise<EventRow[]> => (await db.prepare(`SELECT project_id,event_date,event_name,dimension_key,count FROM event_daily_counts
      WHERE project_id LIKE 'load-%' AND event_date>=? ORDER BY project_id,event_date,event_name,dimension_key`).bind(fixture.oldest).all<EventRow>()).results;
    const flowRows = async (): Promise<FlowRow[]> => (await db.prepare(`SELECT project_id,cohort_date,dimension_key,started_count,succeeded_count,failed_count FROM workflow_daily_counts
      WHERE cohort_date>=? ORDER BY project_id,cohort_date,dimension_key`).bind(fixture.oldest).all<FlowRow>()).results;
    const expectedEvents = await eventRows(), expectedFlows = await flowRows(), seeded = await size();
    const eventMap = new Map(expectedEvents.map(row => [[row.project_id, row.event_date, row.event_name, row.dimension_key].join('|'), row]));
    const flowMap = new Map(expectedFlows.map(row => [[row.project_id, row.cohort_date, row.dimension_key].join('|'), row]));
    const added = new Map(RETAINED_PROJECTS.map(id => [id, 0]));
    const url = await mf.ready; assert.equal(url.hostname, '127.0.0.1');
    const occurredAt = new Date(now).toISOString(), jobs: { offsetMs: number; value: Job }[] = [];
    for (let wave = 0; wave < WAVES; wave++) {
      const project = RETAINED_PROJECTS[wave % RETAINED_PROJECTS.length]!, tool = TOOLS[wave % TOOLS.length]!;
      const workflowBody = JSON.stringify({ schemaVersion: 1, source: 'browser', events: Array.from({ length: 10 }, () => {
        const attempt = { workflowId: 'calculation', attemptId: crypto.randomUUID(), startedAt: occurredAt };
        return ['input_start', 'calculation_success'].map(name => ({ eventId: crypto.randomUUID(), name, occurredAt, properties: { tool }, attempt }));
      }).flat() });
      const kind = wave % 2 ? 'pdf' : 'image';
      const runs = Array.from({ length: 10 }, () => ({ funnelId: 'conversion', runId: crypto.randomUUID(), startedAt: occurredAt }));
      const events = (names: string[]) => runs.flatMap(funnel => names.map(name => ({ eventId: crypto.randomUUID(), name, occurredAt, properties: { kind }, funnel })));
      const browserBody = JSON.stringify({ schemaVersion: 1, source: 'browser', events: events(['file_selected', 'upload_finished']) });
      const serverBody = JSON.stringify({ schemaVersion: 1, source: 'server', events: events(['job_started', 'job_finished']) });
      for (let worker = 0; worker < WORKERS; worker++) jobs.push(
        { offsetMs: wave * 2000, value: { kind: 'workflow', worker, project, tool, body: workflowBody } },
        { offsetMs: wave * 2000, value: { kind: 'browser-funnel', worker, project: configured.project.id, body: browserBody } },
        { offsetMs: wave * 2000, value: { kind: 'server-funnel', worker, project: configured.project.id, body: serverBody } },
        { offsetMs: wave * 2000 + 300, value: { kind: 'summary', worker, project } },
        { offsetMs: wave * 2000 + 300, value: { kind: 'funnel', worker, project: configured.project.id } });
    }
    for (let i = 0; i < 24; i++) jobs.push({ offsetMs: i * 5000, value: { kind: 'cleanup', worker: i % WORKERS } });
    jobs.sort((a, b) => a.offsetMs - b.offsetMs);
    const scheduled = await Promise.all(collectorNames.map(async name => {
      const worker = await mf.getWorker(name);
      if (!('scheduled' in worker) || typeof worker.scheduled !== 'function') throw Error('missing-scheduled-handler');
      return worker.scheduled.bind(worker);
    }));
    phase = 'warm-authenticated-workers';
    for (let worker = 0; worker < WORKERS; worker++) {
      const response = await fetch(new URL(`/worker/${worker}/v1/projects/${configured.project.id}/summary?schemaVersion=1&from=${today}&to=${today}`, url),
        { headers: { Authorization: `Bearer ${adminToken}` }, signal });
      assert.equal(response.status, 200); assert.equal(response.headers.get('X-Tallyfin-Bench-Worker'), collectorNames[worker]); await response.arrayBuffer();
    }
    let httpInFlight = 0, peakHttpInFlight = 0, cleanupOverlappedHttp = 0;
    phase = 'paced-http-and-cleanup'; const started = performance.now();
    await pace(jobs, WINDOW_MS, 16, async (job, lagMs) => {
      const at = performance.now(); let status = 200, accepted = 0, duplicates = 0;
      try {
        if (job.kind === 'cleanup') {
          if (httpInFlight > 0) cleanupOverlappedHttp++;
          assert.equal((await scheduled[job.worker]!({ scheduledTime: Date.now(), cron: '* * * * *' })).outcome, 'ok');
        } else {
          peakHttpInFlight = Math.max(peakHttpInFlight, ++httpInFlight);
          try {
            const write = 'body' in job;
            const path = write ? `/v1/projects/${job.project}/${job.kind === 'server-funnel' ? 'server-batches' : 'batches'}`
              : job.kind === 'summary' ? `/v1/projects/${job.project}/summary?schemaVersion=1&from=${today}&to=${today}`
                : `/v1/projects/${job.project}/funnels/conversion/daily?schemaVersion=1&from=${today}&to=${today}`;
            const response = await fetch(new URL(`/worker/${job.worker}${path}`, url), { method: write ? 'POST' : 'GET',
              headers: write ? job.kind === 'server-funnel' ? { 'Content-Type': 'application/json', Authorization: `Bearer ${publisherToken}` }
                : { 'Content-Type': 'application/json', Origin: 'https://sembom.example.invalid', ...(job.kind === 'browser-funnel' ? { Origin: 'https://modufile.example.invalid' } : {}) }
                : { Authorization: `Bearer ${adminToken}` }, ...(write ? { body: job.body } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
            status = response.status; assert.equal(status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.equal(response.headers.get('X-Tallyfin-Bench-Worker'), collectorNames[job.worker]);
            const data = await response.json() as { accepted?: number; duplicates?: number; totalEvents?: number; summary?: { startedRuns: number; completedRuns: number } };
            if (write) {
              accepted = data.accepted!; duplicates = data.duplicates!;
              assert.ok((accepted === 20 && duplicates === 0) || (accepted === 0 && duplicates === 20));
              if (accepted && job.kind === 'workflow') {
                added.set(job.project, added.get(job.project)! + accepted);
                for (const name of ['input_start', 'calculation_success']) {
                  const row = eventMap.get([job.project, today, name, dimensionKey({ tool: job.tool! })].join('|')); assert.ok(row); row.count += 10;
                }
                const row = flowMap.get([job.project, today, dimensionKey({ tool: job.tool! })].join('|')); assert.ok(row);
                row.started_count += 10; row.succeeded_count += 10;
              }
            } else if (job.kind === 'summary') assert.ok(Number.isSafeInteger(data.totalEvents) && data.totalEvents! >= 1800);
            else assert.ok(data.summary && Number.isSafeInteger(data.summary.startedRuns) && data.summary.completedRuns <= data.summary.startedRuns);
          } finally { httpInFlight--; }
        }
      } finally { observations.push({ kind: job.kind, worker: job.worker, ms: performance.now() - at, lagMs, status, accepted, duplicates }); }
    }, signal);
    const elapsedMs = performance.now() - started; phase = 'verify-db-and-all-instances';
    assert.equal(localDate(Date.now(), 'Asia/Seoul'), today); assert.equal(observations.length, 924); assert.ok(cleanupOverlappedHttp > 0);
    assert.equal(observations.reduce((sum, row) => sum + row.accepted, 0), 3600);
    assert.equal(observations.reduce((sum, row) => sum + row.duplicates, 0), 7200);
    assert.deepEqual(await eventRows(), expectedEvents); assert.deepEqual(await flowRows(), expectedFlows);
    for (const project of RETAINED_PROJECTS) {
      assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_receipts WHERE project_id=?').bind(project).first('n'), 10000 + added.get(project)!);
      assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM workflow_attempts WHERE project_id=?').bind(project).first('n'), 10000 + added.get(project)! / 2);
    }
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_receipts WHERE project_id=?').bind(configured.project.id).first('n'), 2400);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM funnel_runs').first('n'), 600);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM funnel_runs WHERE json_array_length(step_times_json)=4 AND NOT EXISTS (SELECT 1 FROM json_each(step_times_json) WHERE type='null')").first('n'), 600);
    assert.deepEqual((await db.prepare('SELECT source,event_name,SUM(count) AS n FROM event_daily_counts WHERE project_id=? GROUP BY source,event_name ORDER BY source,event_name')
      .bind(configured.project.id).all()).results, configured.events.map(event => ({ source: event.source, event_name: event.name, n: 600 }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.event_name.localeCompare(b.event_name)));
    for (const [index, name] of collectorNames.entries()) {
      const shared = await mf.getD1Database('DB', name);
      assert.deepEqual((await shared.prepare('SELECT step_index,SUM(reached_count) AS n FROM funnel_daily_counts GROUP BY step_index ORDER BY step_index').all()).results,
        [0, 1, 2, 3].map(step_index => ({ step_index, n: 600 })));
      const response = await fetch(new URL(`/worker/${index}/v1/projects/${configured.project.id}/funnels/conversion/daily?schemaVersion=1&from=${today}&to=${today}`, url),
        { headers: { Authorization: `Bearer ${adminToken}` }, signal });
      assert.equal(response.status, 200);
      const result = await response.json() as { summary: { startedRuns: number; completedRuns: number; completionRate: number } };
      assert.equal(result.summary.startedRuns, 600); assert.equal(result.summary.completedRuns, 600); assert.equal(result.summary.completionRate, 100);
    }
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM event_daily_counts WHERE event_date<?').bind(fixture.oldest).first('n'), 0);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM workflow_daily_counts WHERE cohort_date<?').bind(fixture.oldest).first('n'), 0);
    assert.equal(await db.prepare('SELECT revision FROM retention_cleanup_state').first('revision'), 24);
    const kinds = [...new Set(observations.map(row => row.kind))];
    const report = { schemaVersion: 'tallyfin.cluster-bench/v1', local: true, syntheticData: true, verified: true,
      topology: 'three-collector-isolates-one-workerd-one-local-d1', existingDatabasesAccessed: false, remoteChanges: false,
      workerClock: 'live', node: process.version, host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length },
      miniflare: JSON.parse(await readFile(join(root, 'node_modules/miniflare/package.json'), 'utf8')).version,
      windowMs: WINDOW_MS, elapsedMs, collectorWorkers: WORKERS, offeredHttpRequestsPerSecond: 7.5, maxInFlight: 16,
      peakHttpInFlight, seeded, after: await size(), accepted: 3600, duplicates: 7200, cleanupInvocations: 24, cleanupOverlappedHttp,
      latency: Object.fromEntries(kinds.map(kind => [kind, latency(observations.filter(row => row.kind === kind).map(row => row.ms))])),
      launchLag: latency(observations.map(row => row.lagMs)), observations };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' }); return { ...report, output };
  } catch {
    await writeFile(join(output, 'failure.json'), JSON.stringify({ local: true, phase, verified: false, completed: observations.length, observations }), { flag: 'wx' });
    throw Error(`Cluster benchmark failed during ${phase}. Inspect ${output}/failure.json.`);
  } finally { await mf.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('npm run bench:cluster\nThree local collector isolates share a new synthetic D1. 120 seconds, 7.5 HTTP requests/second plus scheduled cleanup. No existing DB, credentials or remote target options. Reports in .tmp/cluster-bench/. Not distributed production capacity proof.');
  else if (args.length) { console.error('No options are accepted. Use --help.'); process.exitCode = 1; }
  else {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    runClusterBench(AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]))
      .then(({ observations: _observations, ...report }) => console.log(JSON.stringify(report)))
      .catch(error => { console.error(error.message); process.exitCode = 1; })
      .finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  }
}
