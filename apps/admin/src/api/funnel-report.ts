import type { ApiClient } from './client.ts';
import { ApiError } from './api-error.ts';
import { validateFunnelResponse, type FunnelResponse } from './funnel-contract.ts';
import type { Registry } from './types.ts';
import type { DateRange } from './dates.ts';

export type FunnelReportState = { phase: 'idle' | 'loading' | 'ready' | 'error'; context: string; funnelId: string;
  data?: FunnelResponse; error?: ApiError };
export class FunnelReport {
  state: FunnelReportState = { phase: 'idle', context: '', funnelId: '' };
  #generation = 0; #controller?: AbortController; #disposed = false;
  readonly client: ApiClient; readonly onChange: (state: FunnelReportState) => void;
  constructor(client: ApiClient, onChange: (state: FunnelReportState) => void) { this.client = client; this.onChange = onChange; }
  async load(registry: Registry, range: DateRange, funnelId: string, context: string): Promise<void> {
    if (this.#disposed) return;
    this.#controller?.abort(); const controller = new AbortController(), generation = ++this.#generation;
    this.#controller = controller; this.#set({ phase: 'loading', context, funnelId });
    try {
      if (!registry.funnels?.some(funnel => funnel.id === funnelId)) throw new ApiError('invalid_request', '등록된 퍼널을 선택해 주세요.');
      const data = await this.client.getFunnelDaily(registry.project.id, funnelId, { schemaVersion: registry.schemaVersion, ...range, signal: controller.signal });
      if (controller.signal.aborted || generation !== this.#generation || this.#disposed) return;
      validateFunnelResponse(data, registry, range, funnelId);
      this.#set({ phase: 'ready', context, funnelId, data });
    } catch (error) {
      if (controller.signal.aborted || generation !== this.#generation || this.#disposed) return;
      this.#set({ phase: 'error', context, funnelId, error: error instanceof ApiError ? error : new ApiError('contract', '퍼널 응답이 등록된 정의와 맞지 않아요.') });
    }
  }
  cancel(): void { ++this.#generation; this.#controller?.abort(); this.#controller = undefined; this.state = { phase: 'idle', context: '', funnelId: '' }; }
  dispose(): void { this.#disposed = true; this.cancel(); }
  #set(state: FunnelReportState): void { this.state = state; this.onChange(state); }
}
