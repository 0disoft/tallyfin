import type { ApiClient } from './client.ts';
import { ApiError } from './api-error.ts';
import type { DraftContent, DraftSnapshot } from './saved-draft-contract.ts';

export type SavedDraftState = { phase: 'idle' | 'loading' | 'ready' | 'saving' | 'error'; snapshot: DraftSnapshot | null;
  pending: DraftContent | null; confirmed: DraftContent | null; reviewRequired: boolean; error: string | null };
type Client = Pick<ApiClient, 'getSchemaDraft' | 'saveSchemaDraft'>;
const same = (a: DraftContent, b: DraftContent) => a.targetVersion === b.targetVersion && a.draftText === b.draftText;

/** One session/project lifetime. Only explicit writes; uncertain writes require a fresh read and review. */
export class SavedDraftController {
  state: SavedDraftState = { phase: 'idle', snapshot: null, pending: null, confirmed: null, reviewRequired: false, error: null };
  #client: Client; #projectId: string; #controller: AbortController | null = null; #generation = 0; #destroyed = false;
  #listeners = new Set<(state: SavedDraftState) => void>();
  constructor(client: Client, projectId: string) { this.#client = client; this.#projectId = projectId; }
  subscribe(listener: (state: SavedDraftState) => void) { this.#listeners.add(listener); listener(this.state); return () => { this.#listeners.delete(listener); }; }
  #set(patch: Partial<SavedDraftState>) {
    if (this.#destroyed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.#listeners) { try { listener(this.state); } catch { /* A UI observer cannot change a confirmed write. */ } }
  }
  #start() { this.#controller?.abort(); const controller = new AbortController(); this.#controller = controller; return { controller, generation: ++this.#generation }; }
  #current(generation: number) { return !this.#destroyed && generation === this.#generation && !this.#controller?.signal.aborted; }
  async load() {
    if (this.#destroyed || this.state.phase === 'saving' || this.state.phase === 'loading') return;
    const pending = this.state.pending, reviewRequired = this.state.reviewRequired, { controller, generation } = this.#start();
    this.#set({ phase: 'loading', snapshot: null, confirmed: null, error: null });
    try {
      const snapshot = await this.#client.getSchemaDraft(this.#projectId, { signal: controller.signal });
      if (!this.#current(generation)) return;
      const matched = Boolean(pending && snapshot.draft && same(pending, snapshot.draft));
      this.#set({ phase: 'ready', snapshot, pending: matched ? null : pending, reviewRequired: reviewRequired && !matched,
        confirmed: matched ? pending : null });
    } catch (error) {
      if (this.#current(generation)) this.#set({ phase: 'error', snapshot: null,
        error: error instanceof ApiError ? error.message : '서버 초안을 읽지 못했어요. 다시 확인해 주세요.' });
    }
  }
  async save(content: DraftContent) {
    if (this.#destroyed || this.state.phase !== 'ready' || !this.state.snapshot || this.state.reviewRequired) return;
    const pending = { targetVersion: content.targetVersion, draftText: content.draftText };
    const expectedRevision = this.state.snapshot.draft?.revision ?? null, { controller, generation } = this.#start();
    this.#set({ phase: 'saving', pending, confirmed: null, error: null });
    try {
      const snapshot = await this.#client.saveSchemaDraft(this.#projectId, { ...pending, expectedRevision }, { signal: controller.signal });
      if (this.#current(generation)) this.#set({ phase: 'ready', snapshot, pending: null, confirmed: pending, reviewRequired: false });
    } catch (error) {
      if (!this.#current(generation)) return;
      const invalid = error instanceof ApiError && error.kind === 'invalid_request';
      this.#set({ phase: invalid ? 'ready' : 'error', snapshot: invalid ? this.state.snapshot : null,
        pending: invalid ? null : pending, reviewRequired: !invalid, error: error instanceof ApiError ? error.message : '저장 결과를 확인하지 못했어요. 서버 초안을 다시 확인해 주세요.' });
    }
  }
  /** A new snapshot is only a baseline after the user explicitly reviews a conflict. Never writes. */
  acceptReview() {
    if (this.state.phase === 'ready' && this.state.snapshot) this.#set({ pending: null, reviewRequired: false, error: null });
  }
  suspend() {
    if (this.#destroyed) return;
    const saving = this.state.phase === 'saving';
    ++this.#generation; this.#controller?.abort();
    this.#set({ phase: 'idle', snapshot: null, confirmed: null, reviewRequired: this.state.reviewRequired || saving,
      error: null });
  }
  destroy() { this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear(); }
}
