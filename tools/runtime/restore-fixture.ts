import { readFile } from 'node:fs/promises';
import { parseBatch, parseServerBatch, prepareBatch, prepareServerBatch, validateRegistry } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { D1Store, D1Maintenance } from '@tallyfin/storage-d1';
import { initialize } from '../provision/local.ts';
import { Provisioner } from '../provision/store.ts';
import { CreatorProvisioner } from '../provision/creators.ts';
import { PublisherProvisioner } from '../provision/publishers.ts';

export const DRILL_TIME = Date.parse('2026-10-08T15:00:15Z');
const principal = { issuer: 'https://identity.example.invalid', subject: 'synthetic-restore-operator' };
export async function restoreExample(name: string) { return JSON.parse(await readFile(new URL(`../../api/examples/${name}.json`, import.meta.url), 'utf8')); }

/** Uses public example contracts and synthetic principals only, on a newly-created local DB. */
export async function seedRestoreFixture(db: SqlDatabase) {
  await initialize(db, true);
  const browserDefinition = await restoreExample('registry');
  Object.assign(browserDefinition.workflows[0], { failureEvent: 'validation_error', failureReasonProperty: 'error' });
  const browser = validateRegistry(browserDefinition);
  const funnel = validateRegistry(await restoreExample('funnel-registry'));
  const registryTool = new Provisioner(db);
  for (const registry of [browser, funnel]) {
    await registryTool.apply(await registryTool.plan('register', registry), DRILL_TIME);
    await registryTool.apply(await registryTool.plan('grant', { projectId: registry.project.id, ...principal, role: 'owner' }), DRILL_TIME);
  }
  const creatorTool = new CreatorProvisioner(db), publisherTool = new PublisherProvisioner(db);
  await creatorTool.apply(await creatorTool.plan('creator-grant', { ...principal, maxProjects: 5 }), DRILL_TIME);
  await publisherTool.apply(await publisherTool.plan('publisher-grant', { projectId: funnel.project.id, ...principal }), DRILL_TIME);
  const store = new D1Store(db);
  const { D1Queries } = await import('@tallyfin/storage-d1');
  await new D1Queries(db).saveSchemaDraft(principal, browser.project.id,
    { expectedRevision: null, targetVersion: '2', draftText: '{unfinished restore draft 한글' }, DRILL_TIME);
  const workflowInput = await restoreExample('browser-batch');
  await store.commit(await prepareBatch(parseBatch(JSON.stringify(workflowInput)), browser, DRILL_TIME), browser);
  const failureInput = structuredClone(workflowInput), failureId = crypto.randomUUID();
  failureInput.events.forEach((event: any, index: number) => {
    event.eventId = crypto.randomUUID(); event.attempt.attemptId = failureId;
    event.attempt.startedAt = '2026-10-08T14:59:51Z';
    event.occurredAt = index === 0 ? event.attempt.startedAt : '2026-10-08T14:59:54Z';
    if (index === 1) { event.name = 'validation_error'; event.properties.error = 'range'; }
  });
  // A terminal received before its start must retain its failure reason and 3s duration.
  for (const index of [1, 0]) {
    const input = { ...failureInput, events: [failureInput.events[index]] };
    await store.commit(await prepareBatch(parseBatch(JSON.stringify(input)), browser, DRILL_TIME), browser);
  }
  const startedAt = '2026-10-08T15:00:00.000Z', runId = crypto.randomUUID();
  const funnelInputs = [0, 1, 2, 3].map(index => {
    const step = funnel.funnels![0]!.steps[index]!;
    return { schemaVersion: 1, source: step.source, events: [{ eventId: crypto.randomUUID(), name: step.eventName,
      occurredAt: new Date(Date.parse(startedAt) + index * 1000).toISOString(), properties: { kind: 'pdf' },
      funnel: { funnelId: funnel.funnels![0]!.id, runId, startedAt } }] };
  });
  // Deliberately deliver the last milestone first: restore must retain the completed ordered run.
  for (const index of [3, 0, 2, 1]) {
    const input = funnelInputs[index]!;
    if (input.source === 'browser') await store.commit(await prepareBatch(parseBatch(JSON.stringify(input)), funnel, DRILL_TIME), funnel);
    else await store.commitServer(await prepareServerBatch(parseServerBatch(JSON.stringify(input)), funnel, DRILL_TIME), funnel, principal);
  }
  await store.admit(browser.project.id, DRILL_TIME, 120);
  await store.recordRejection(browser.project.id, DRILL_TIME, 'invalid_event');
  // Seed an immutable creation record and a safe-boundary counter to detect export precision loss.
  await db.batch([
    db.prepare('INSERT INTO project_creations(project_id,issuer,subject,request_hash,created_at) VALUES (?,?,?,?,?)')
      .bind(browser.project.id, principal.issuer, principal.subject, 'a'.repeat(64), DRILL_TIME),
    db.prepare('UPDATE event_daily_counts SET count=? WHERE project_id=? AND event_name=?')
      .bind(Number.MAX_SAFE_INTEGER, browser.project.id, 'calculation_success'),
  ]);
  const maintenance = new D1Maintenance(db);
  if (!await maintenance.advanceCleanupCursor(await maintenance.nextCleanupPage(1))) throw Error('cleanup_cursor_not_seeded');
  return { browser, funnel, workflowInput, failureInput, funnelInputs, principal };
}
