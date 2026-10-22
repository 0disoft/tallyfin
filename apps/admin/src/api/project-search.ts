import { ApiError, DEFAULT_PAGE_LIMIT, MAX_PROJECT_SEARCH_CHARS, type ApiClient } from './client.ts';
import { appendPage } from './pagination.ts';
import type { Project } from './types.ts';

export const PROJECT_SEARCH_DELAY_MS = 250;
export type ProjectSearchState = {
  query: string; phase: 'idle' | 'loading' | 'ready' | 'error'; items: Project[];
  nextCursor: string | null; more: boolean; message: string | null;
};
const empty = (query = ''): ProjectSearchState => ({ query, phase: query ? 'loading' : 'idle', items: [], nextCursor: null, more: false, message: null });

/** Search is separate from the dashboard list and never changes the active project. */
export class ProjectSearch {
  state = empty();
  #client: Pick<ApiClient, 'listProjects'>;
  #controller: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0; #destroyed = false;
  #listeners = new Set<(state: ProjectSearchState) => void>();
  constructor(client: Pick<ApiClient, 'listProjects'>) { this.#client = client; }
  subscribe(listener: (state: ProjectSearchState) => void): () => void {
    this.#listeners.add(listener); listener(this.state);
    return () => { this.#listeners.delete(listener); };
  }
  #set(state: ProjectSearchState) {
    if (this.#destroyed) return;
    this.state = state; for (const listener of this.#listeners) listener(state);
  }
  #cancel() {
    ++this.#generation; this.#controller?.abort(); this.#controller = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
  search(input: string): void {
    if (this.#destroyed) return;
    this.#cancel();
    const query = input.trim();
    this.#set(empty(query));
    if (input.length > MAX_PROJECT_SEARCH_CHARS || /[\x00-\x1f\x7f]/.test(input)) {
      this.#set({ ...empty(query), phase: 'error', message: '프로젝트 검색어는 제어 문자 없이 80자 이내로 입력해 주세요.' });
      return;
    }
    if (query) this.#timer = setTimeout(() => { this.#timer = null; void this.#load(null); }, PROJECT_SEARCH_DELAY_MS);
  }
  async next(): Promise<void> {
    if (this.state.phase === 'ready' && this.state.nextCursor && !this.state.more) await this.#load(this.state.nextCursor);
  }
  async retry(): Promise<void> {
    if (this.state.phase === 'error') this.search(this.state.query);
    else if (this.state.message) await this.next();
  }
  async #load(cursor: string | null): Promise<void> {
    if (this.#destroyed) return;
    const controller = new AbortController(); this.#controller = controller;
    const generation = this.#generation, query = this.state.query;
    const current = () => !this.#destroyed && generation === this.#generation && !controller.signal.aborted;
    this.#set({ ...this.state, more: cursor !== null, message: null });
    try {
      const page = await this.#client.listProjects({ q: query, cursor, limit: DEFAULT_PAGE_LIMIT, signal: controller.signal });
      if (!current()) return;
      if (page.page.nextCursor && (page.page.nextCursor === cursor || cursor && page.page.nextCursor < cursor))
        throw new ApiError('contract', '프로젝트 검색 페이지가 앞으로 진행하지 않아요.');
      this.#set({ query, phase: 'ready', items: cursor ? appendPage(this.state.items, page).items : page.data,
        nextCursor: page.page.nextCursor, more: false, message: null });
    } catch (error) {
      if (!current()) return;
      const denied = error instanceof ApiError && ['unauthorized', 'forbidden'].includes(error.kind);
      const message = error instanceof ApiError ? error.message : '프로젝트를 검색하지 못했어요. 다시 시도해 주세요.';
      this.#set({ ...(denied || !cursor ? empty(query) : this.state), phase: cursor && !denied ? 'ready' : 'error', more: false, message });
    } finally { if (this.#controller === controller) this.#controller = null; }
  }
  destroy(): void { this.#cancel(); this.#destroyed = true; this.state = empty(); this.#listeners.clear(); }
}
