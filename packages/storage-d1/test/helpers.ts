import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { D1Store } from '../src/index.ts';
import { parseBatch, prepareBatch, validateRegistry } from '@tallyfin/core';

export const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../api/examples/${name}.json`, import.meta.url), 'utf8'));
export const now = Date.parse('2026-10-08T15:00:15Z');
export const registry = validateRegistry(example('registry'));
export const batch = () => example('browser-batch');
export function migrationStatements(): string[] {
  const sql = ['0001_initial.sql', '0002_retention_cleanup.sql', '0003_project_creation.sql', '0004_collection_rejections.sql', '0005_admin_changes.sql', '0006_server_collection.sql', '0007_task_funnels.sql', '0008_publisher_history.sql'].map(name =>
    readFileSync(new URL(`../../../db/migrations/${name}`, import.meta.url), 'utf8').replace(/^--.*$/gm, '')).join('\n');
  // This migration contains no quoted semicolons; preserve complete trigger bodies.
  return [...sql.matchAll(/\s*(CREATE TRIGGER[\s\S]*?END;|[^;]+;)/g)].map(match => match[1]!.trim());
}
export async function setup() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch() { return new Response(null, {status:404}); }}',
    compatibilityDate: '2026-08-06', d1Databases: { DB: 'tallyfin-storage-tests' } });
  const db = await mf.getD1Database('DB');
  try {
    for (const sql of migrationStatements()) await db.prepare(sql).run();
    await seed(db);
  } catch (error) { await mf.dispose(); throw error; }
  return { mf, db, store: new D1Store(db) };
}
export async function seed(db: Awaited<ReturnType<Miniflare['getD1Database']>>, id = registry.project.id) {
  await db.batch([
    db.prepare(`INSERT INTO projects (id, name, status, time_zone, allowed_origins_json, requests_per_minute, new_receipts_per_utc_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, registry.project.name, 'active', registry.project.timeZone, JSON.stringify(registry.allowedOrigins), 120, 100000, now),
    db.prepare(`INSERT INTO project_schemas (project_id, version, status, definitions_json, published_at) VALUES (?, 1, 'active', ?, ?)`)
      .bind(id, JSON.stringify({ events: registry.events, workflows: registry.workflows }), now),
  ]);
}
export const prepare = (input = batch(), at = now, r = registry) => prepareBatch(parseBatch(JSON.stringify(input)), r, at);
