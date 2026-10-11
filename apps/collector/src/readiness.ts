import { CollectionError } from '@tallyfin/core';
import type { SqlDatabase } from '@tallyfin/storage-d1';

/** Probe only the two administrator control-plane tables; no row contents, writes or global scans. */
export async function checkAdministratorStorageRead(db: SqlDatabase): Promise<void> {
  const result = await db.batch<{ available: number }>([
    db.prepare('SELECT 1 AS available FROM projects LIMIT 1'),
    db.prepare('SELECT 1 AS available FROM project_grants LIMIT 1'),
  ]);
  if (result.length !== 2 || result.some(item => !item.success || !Array.isArray(item.results) ||
    item.results.length > 1 || item.results.some(row => row.available !== 1)))
    throw new CollectionError('storage_unavailable', 503);
}
