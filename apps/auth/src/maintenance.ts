import { DurableObject } from 'cloudflare:workers';
import type { CollectorMaintenance } from '../../collector/src/maintenance-runtime.ts';

// Wrangler cannot infer cross-Worker RPC methods from an independently generated config.
type MaintenanceBindings = AuthEnv & { COLLECTOR_MAINTENANCE: Service<CollectorMaintenance> };

/** One installation clock; never receives requests or analytics event payloads. */
export class MaintenanceClock extends DurableObject<MaintenanceBindings> {
  async start() {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return this.status();
  }
  async status() {
    return { nextAt: await this.ctx.storage.getAlarm(),
      lastRun: await this.ctx.storage.get<{ completedAt: number; succeeded: boolean }>('lastRun') ?? null };
  }
  async alarm() {
    // Persist the next run before external work so a dependency failure cannot stop the clock.
    await this.ctx.storage.setAlarm(Date.now() + (this.env.MAINTAIN_COLLECTOR === 'true' ? 60000 : 3600000));
    const results = await Promise.allSettled([
      this.cleanAuthentication(),
      this.env.MAINTAIN_COLLECTOR === 'true' ? this.env.COLLECTOR_MAINTENANCE.run() : Promise.resolve(),
    ]);
    const succeeded = results.every(result => result.status === 'fulfilled');
    await this.ctx.storage.put('lastRun', { completedAt: Date.now(), succeeded });
    if (!succeeded) console.error(JSON.stringify({ code: 'maintenance_failed' }));
  }
  private async cleanAuthentication() {
    const now = Date.now(), last = await this.ctx.storage.get<number>('authCleanedAt') ?? 0;
    if (now - last < 3600000) return;
    await this.env.AUTH_DB.prepare('DELETE FROM rateLimit WHERE lastRequest < ?').bind(now - 86400000).run();
    await this.ctx.storage.put('authCleanedAt', now);
  }
}
