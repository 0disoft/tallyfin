import { ApiClient, ApiError } from './client.ts';
import { parsePublisherRequest } from './publishers-contract.ts';
import type { PublisherMutationResult, PublisherRequest } from './publishers-contract.ts';

export type PublisherEditorState = {
  phase: 'idle' | 'review' | 'saving' | 'uncertain' | 'error' | 'denied' | 'success';
  request: PublisherRequest | null; message: string | null;
};
type Callbacks = { onSaved?: (result: PublisherMutationResult) => void; onAccessLost?: () => void };
const initial = (): PublisherEditorState => ({ phase: 'idle', request: null, message: null });
/** One explicit publisher permission write at a time. Unknown outcomes retain only the exact reviewed request. */
export class PublisherEditor {
  state: PublisherEditorState = initial();
  #client: ApiClient; #projectId: string; #callbacks: Callbacks;
  #listeners = new Set<(state: PublisherEditorState) => void>();
  #controller: AbortController | null = null; #destroyed = false; #accessLost = false; #generation = 0;
  constructor(client: ApiClient, projectId: string, callbacks: Callbacks = {}) {
    this.#client = client; this.#projectId = projectId; this.#callbacks = callbacks;
  }
  get hasUnsavedChanges(): boolean {
    return !this.#destroyed && !this.#accessLost && this.state.request !== null;
  }
  subscribe(listener: (state: PublisherEditorState) => void): () => void {
    this.#listeners.add(listener); this.#notify(() => listener(this.state)); return () => { this.#listeners.delete(listener); };
  }
  #set(state: PublisherEditorState) {
    if (this.#destroyed) return;
    this.state = state; for (const listener of this.#listeners) this.#notify(() => listener(state));
  }
  prepare(input: PublisherRequest): boolean {
    if (this.#destroyed || this.#accessLost || ['saving', 'uncertain', 'denied'].includes(this.state.phase)) return false;
    try {
      const request = Object.freeze(parsePublisherRequest(input));
      this.#set({ phase: 'review', request, message: null }); return true;
    } catch {
      this.#set({ phase: 'error', request: null, message: 'HTTPS 발급자 주소와 계정 식별자를 확인해 주세요.' });
      return false;
    }
  }
  cancel(): void {
    if (!this.#destroyed && !['saving', 'uncertain', 'denied'].includes(this.state.phase)) this.#set(initial());
  }
  async confirm(): Promise<void> {
    if (this.#destroyed || this.#accessLost || !['review', 'uncertain'].includes(this.state.phase) || !this.state.request) return;
    const request = this.state.request, controller = new AbortController(); this.#controller = controller;
    const generation = ++this.#generation;
    const current = () => !this.#destroyed && generation === this.#generation && !controller.signal.aborted;
    this.#set({ phase: 'saving', request, message: null });
    let result: PublisherMutationResult;
    try { result = await this.#client.changePublisher(this.#projectId, request, { signal: controller.signal }); }
    catch (error) {
      if (!current()) return;
      const kind = error instanceof ApiError ? error.kind : null;
      if (kind === 'unauthorized' || kind === 'forbidden') {
        this.#accessLost = true;
        this.#set({ phase: 'denied', request: null, message: '발행 권한을 변경할 수 없어요. 최신 설정이나 연결을 확인해 주세요.' });
        this.#notify(this.#callbacks.onAccessLost); return;
      }
      // A conflict keeps the reviewed request so the caller can re-read the list and retry deliberately.
      if (kind === 'publisher_conflict' || kind === 'invalid_request') {
        this.#set({ phase: 'error', request, message: (error as ApiError).message }); return;
      }
      this.#set({ phase: 'uncertain', request, message: '저장 결과를 확인하지 못했어요. 입력은 고정했어요. 같은 요청으로 결과를 다시 확인해 주세요.' });
      return;
    }
    if (!current()) return;
    const message = request.granted
      ? result.changed ? '서버 발행 권한을 저장했어요.' : '이미 발행 권한이 있는 계정이에요. 결과를 확인했어요.'
      : result.changed ? '서버 발행 권한을 회수했어요.' : '이미 발행 권한이 없는 계정이에요. 결과를 확인했어요.';
    this.#set({ phase: 'success', request: null, message });
    // UI callbacks cannot turn a confirmed write into an unknown outcome or trigger a replay.
    this.#notify(() => this.#callbacks.onSaved?.(result));
  }
  #notify(callback: (() => void) | undefined) {
    if (this.#destroyed) return;
    try { callback?.(); } catch { /* Notifications cannot change request outcomes or skip access-loss handling. */ }
  }
  destroy(): void {
    this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear(); this.#callbacks = {};
    this.state = initial();
  }
}
