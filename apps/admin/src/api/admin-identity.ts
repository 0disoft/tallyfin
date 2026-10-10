import { ApiError, type ApiClient } from './client.ts';
import { parseAdminIdentity, type AdminIdentity } from './admin-identity-contract.ts';
export { parseAdminIdentity, identityJson, type AdminIdentity } from './admin-identity-contract.ts';
export type IdentityState = { phase: 'idle' | 'loading' | 'ready' | 'error'; identity: AdminIdentity | null; message: string | null };
export const IDENTITY_IDLE: IdentityState = { phase: 'idle', identity: null, message: null };

/** Reads only on explicit opening; closing and disposal clear identities and invalidate late replies. */
export class IdentityReader {
  #client: Pick<ApiClient, 'getIdentity'>;
  #change: (state: IdentityState) => void;
  #state = IDENTITY_IDLE;
  #controller: AbortController | null = null;
  #generation = 0;
  #destroyed = false;
  constructor(client: Pick<ApiClient, 'getIdentity'>, change: (state: IdentityState) => void) { this.#client = client; this.#change = change; }
  get state() { return this.#state; }
  #set(value: IdentityState) { this.#state = value; this.#change(value); }
  async open() {
    if (this.#destroyed || this.#state.phase === 'loading') return;
    const generation = ++this.#generation;
    const controller = new AbortController(); this.#controller = controller;
    this.#set({ phase: 'loading', identity: null, message: null });
    try {
      const identity = parseAdminIdentity(await this.#client.getIdentity({ signal: controller.signal }));
      if (!this.#destroyed && !controller.signal.aborted && generation === this.#generation)
        this.#set({ phase: 'ready', identity, message: null });
    } catch (error) {
      if (!this.#destroyed && !controller.signal.aborted && generation === this.#generation)
        this.#set({ phase: 'error', identity: null, message: error instanceof ApiError ? error.message : '로그인 계정을 확인하지 못했어요. 다시 시도해 주세요.' });
    } finally { if (this.#controller === controller) this.#controller = null; }
  }
  close() { if (this.#destroyed) return; this.#controller?.abort(); this.#controller = null; this.#generation++; this.#set(IDENTITY_IDLE); }
  destroy() { this.#destroyed = true; this.#controller?.abort(); this.#controller = null; this.#generation++; this.#state = IDENTITY_IDLE; }
}
