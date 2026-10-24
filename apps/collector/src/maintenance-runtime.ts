import { WorkerEntrypoint } from 'cloudflare:workers';
import { createWorker, type CollectorBindings } from './index.ts';

/** Service-binding RPC only. No HTTP route exposes cleanup or auth database access. */
export class CollectorMaintenance extends WorkerEntrypoint<Pick<CollectorBindings, 'DB'>> {
  async run(): Promise<void> {
    await createWorker().scheduled({ scheduledTime: Date.now() }, this.env);
  }
}
