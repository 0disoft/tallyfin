import { ApiClient, ApiError } from './client.ts';
import type { ProjectPublisherPage } from './types.ts';

export type PublisherListState = {
  phase: 'loading' | 'ready' | 'error'; data: ProjectPublisherPage | null; message: string | null;
  denied: boolean; cursor: string | null; pageNumber: number;
};
/** One page in memory; publisher identities never survive refresh, failed requests or controller disposal. */
export class PublisherList {
  state: PublisherListState = { phase: 'loading', data: null, message: null, denied: false, cursor: null, pageNumber: 1 };
  #client: ApiClient; #projectId: string; #controller: AbortController | null = null;
  #generation = 0; #destroyed = false; #listeners = new Set<(state: PublisherListState) => void>();
  constructor(client: ApiClient, projectId: string) { this.#client = client; this.#projectId = projectId; }
  subscribe(listener: (state: PublisherListState) => void): () => void {
    this.#listeners.add(listener); listener(this.state); return () => { this.#listeners.delete(listener); };
  }
  #set(state: PublisherListState) { if (this.#destroyed) return; this.state = state; for (const listener of this.#listeners) listener(state); }
  async refresh(): Promise<void> { await this.#load(null, 1); }
  async next(): Promise<void> {
    if (this.state.phase !== 'ready' || !this.state.data?.page.nextCursor) return;
    await this.#load(this.state.data.page.nextCursor, this.state.pageNumber + 1);
  }
  async retry(): Promise<void> {
    if (this.state.phase === 'error' && !this.state.denied) await this.#load(this.state.cursor, this.state.pageNumber);
  }
  async #load(cursor: string | null, pageNumber: number): Promise<void> {
    if (this.#destroyed) return;
    this.#controller?.abort(); const controller = new AbortController(); this.#controller = controller;
    const generation = ++this.#generation;
    const current = () => !this.#destroyed && generation === this.#generation && !controller.signal.aborted;
    this.#set({ phase: 'loading', data: null, message: null, denied: false, cursor, pageNumber });
    try {
      const data = await this.#client.listPublishers(this.#projectId, { limit: 25, cursor, signal: controller.signal });
      if (current()) this.#set({ phase: 'ready', data, message: null, denied: false, cursor, pageNumber });
    } catch (error) {
      if (!current()) return;
      const denied = error instanceof ApiError && ['unauthorized', 'forbidden'].includes(error.kind);
      const message = denied ? '서버 발행자 목록을 조회하려면 현재 프로젝트 소유자 권한이 필요해요. 연결이나 최신 설정을 확인해 주세요.'
        : error instanceof ApiError ? error.message : '서버 발행자 목록을 불러오지 못했어요. 다시 시도해 주세요.';
      this.#set({ phase: 'error', data: null, message, denied, cursor, pageNumber });
    }
  }
  destroy(): void {
    this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear();
    this.state = { phase: 'loading', data: null, message: null, denied: false, cursor: null, pageNumber: 1 };
  }
}
