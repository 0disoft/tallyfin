import { CollectionError, integer } from '@tallyfin/core';
import type { CleanupMetrics } from './retention.ts';
import { D1Store } from './index.ts';
import type { SqlDatabase } from './sql.ts';

export interface CleanupPage {
  revision: number;
  projectCount?: number;
  projects: { id: string; timeZone: string; dailyLimit?: number }[];
}
interface StateRow { last_project_id: string; revision: number }
interface CleanupProjectRow { id: string; time_zone: string; new_receipts_per_utc_day: number; project_count: number }

/** A durable keyset cursor prevents large project lists from starving later IDs. */
export class D1Maintenance {
  readonly db: SqlDatabase;
  #store: D1Store;
  constructor(db: SqlDatabase) { this.db = db; this.#store = new D1Store(db); }
  cleanup(projectId: string, timeZone: string, now: number, limit: number): Promise<void> {
    return this.#store.cleanup(projectId, timeZone, now, limit);
  }
  cleanupReport(projectId: string, timeZone: string, now: number, limit: number): Promise<CleanupMetrics> {
    return this.#store.cleanupReport(projectId, timeZone, now, limit);
  }
  async nextCleanupPage(limit = 5): Promise<CleanupPage> {
    if (!integer(limit, 1, 5)) throw Error('invalid cleanup project limit');
    const state = await this.db.batch<StateRow>([
      this.db.prepare('INSERT OR IGNORE INTO retention_cleanup_state (id) VALUES (1)'),
      this.db.prepare('SELECT last_project_id, revision FROM retention_cleanup_state WHERE id = 1'),
    ]);
    const cursor = state[1]?.results[0];
    if (state.some(result => !result.success) || !cursor || typeof cursor.last_project_id !== 'string' ||
      !integer(cursor.revision, 0, Number.MAX_SAFE_INTEGER - 1)) throw new CollectionError('storage_unavailable', 503);
    const select = async (after: string) => {
      const result = await this.db.batch<CleanupProjectRow>([
        this.db.prepare('SELECT id, time_zone, new_receipts_per_utc_day, (SELECT count(*) FROM projects) AS project_count FROM projects WHERE id > ? ORDER BY id LIMIT ?').bind(after, limit),
      ]);
      if (!result[0]?.success) throw new CollectionError('storage_unavailable', 503);
      return result[0].results;
    };
    let projects = await select(cursor.last_project_id);
    if (!projects.length && cursor.last_project_id) projects = await select('');
    return { revision: cursor.revision, projectCount: projects[0]?.project_count ?? 0,
      projects: projects.map(row => ({ id: row.id, timeZone: row.time_zone, dailyLimit: row.new_receipts_per_utc_day })) };
  }

  async advanceCleanupCursor(page: CleanupPage): Promise<boolean> {
    const lastId = page.projects.at(-1)?.id ?? '';
    const result = await this.db.batch([
      this.db.prepare('UPDATE retention_cleanup_state SET last_project_id = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
        .bind(lastId, page.revision),
    ]);
    if (!result[0]?.success) throw new CollectionError('storage_unavailable', 503);
    return result[0].meta.changes === 1;
  }
}
