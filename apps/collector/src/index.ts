import { D1Queries, D1Store } from '@tallyfin/storage-d1';
import type { SqlDatabase } from '@tallyfin/storage-d1';
import { createCollector } from './handler.ts';
export { createCollector } from './handler.ts';
export type { AdministratorAccess } from './admin.ts';
import type { AdministratorAccess } from './admin.ts';

// Host supplies the D1 binding. No deployed resource ID or credential is committed.
export interface CollectorBindings { DB: SqlDatabase; ALLOW_LOCAL_HTTP?: string }
export function createWorker(verifyBearer?: AdministratorAccess['verifyBearer']) { return {
  async fetch(request: Request, bindings: CollectorBindings): Promise<Response> {
    const store = new D1Store(bindings.DB, { allowLocalHttp: bindings.ALLOW_LOCAL_HTTP === 'true' });
    return createCollector(store, { log: entry => console.warn(JSON.stringify(entry)),
      ...(verifyBearer ? { admin: { store: new D1Queries(bindings.DB, { allowLocalHttp: bindings.ALLOW_LOCAL_HTTP === 'true' }), verifyBearer } } : {}) })(request);
  },
}; }
// Authentication is closed until an embedding host explicitly supplies its trusted verifier.
export default createWorker();
