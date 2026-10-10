import { ApiClient, ApiError } from './client.ts';
import { parseGrantChangeInput } from './grants-contract.ts';
import type { GrantChange, GrantMutationResult } from './grants-contract.ts';

export type GrantEditorState = {
  phase: 'idle' | 'review' | 'saving' | 'uncertain' | 'error' | 'denied' | 'success';
  change: GrantChange | null; message: string | null;
};
type Callbacks = { onSaved?: (result: GrantMutationResult) => void; onAccessLost?: () => void };
const initial = (): GrantEditorState => ({ phase: 'idle', change: null, message: null });
/** One explicit write at a time. Unknown outcomes retain only the exact reviewed request. */
export class GrantEditor {
  state: GrantEditorState = initial();
  #client: ApiClient; #projectId: string; #callbacks: Callbacks;
  #listeners = new Set<(state: GrantEditorState) => void>();
  #controller: AbortController | null = null; #destroyed = false; #accessLost = false; #generation = 0;
  constructor(client: ApiClient, projectId: string, callbacks: Callbacks = {}) {
    this.#client = client; this.#projectId = projectId; this.#callbacks = callbacks;
  }
  subscribe(listener: (state: GrantEditorState) => void): () => void {
    this.#listeners.add(listener); listener(this.state); return () => { this.#listeners.delete(listener); };
  }
  #set(state: GrantEditorState) {
    if (this.#destroyed) return;
    this.state = state; for (const listener of this.#listeners) listener(state);
  }
  prepare(input: GrantChange): boolean {
    if (this.#destroyed || this.#accessLost || ['saving', 'uncertain', 'denied'].includes(this.state.phase)) return false;
    try {
      const change = Object.freeze(parseGrantChangeInput(input));
      this.#set({ phase: 'review', change, message: null }); return true;
    } catch {
      this.#set({ phase: 'error', change: null, message: 'HTTPS 발급자 주소·계정 식별자와 권한을 확인해 주세요.' });
      return false;
    }
  }
  cancel(): void {
    if (!this.#destroyed && !['saving', 'uncertain', 'denied'].includes(this.state.phase)) this.#set(initial());
  }
  async confirm(): Promise<void> {
    if (this.#destroyed || this.#accessLost || !['review', 'uncertain'].includes(this.state.phase) || !this.state.change) return;
    const change = this.state.change, controller = new AbortController(); this.#controller = controller;
    const generation = ++this.#generation;
    const current = () => !this.#destroyed && generation === this.#generation && !controller.signal.aborted;
    this.#set({ phase: 'saving', change, message: null });
    let result: GrantMutationResult;
    try { result = await this.#client.changeGrant(this.#projectId, change, { signal: controller.signal }); }
    catch (error) {
      if (!current()) return;
      const kind = error instanceof ApiError ? error.kind : null;
      if (kind === 'unauthorized' || kind === 'forbidden') {
        this.#accessLost = true;
        this.#set({ phase: 'denied', change: null, message: '권한을 변경할 수 없어요. 최신 설정이나 연결을 확인해 주세요.' });
        this.#notify(this.#callbacks.onAccessLost); return;
      }
      if (kind === 'grant_conflict' || kind === 'last_owner' || kind === 'invalid_request') {
        this.#set({ phase: 'error', change, message: (error as ApiError).message }); return;
      }
      this.#set({ phase: 'uncertain', change, message: '저장 결과를 확인하지 못했어요. 입력은 고정했어요. 같은 요청으로 결과를 다시 확인해 주세요.' });
      return;
    }
    if (!current()) return;
    this.#accessLost = !result.canManage;
    this.#set({ phase: 'success', change: null, message: result.changed ? '권한 변경을 저장했어요.' : '이미 요청한 권한 상태예요. 결과를 확인했어요.' });
    // UI callbacks cannot turn a confirmed write into an unknown outcome or trigger a replay.
    if (!result.canManage) this.#notify(this.#callbacks.onAccessLost);
    this.#notify(() => this.#callbacks.onSaved?.(result));
  }
  #notify(callback: (() => void) | undefined) { try { callback?.(); } catch { /* The confirmed server result remains authoritative. */ } }
  destroy(): void {
    this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear(); this.#callbacks = {};
    this.state = initial();
  }
}
