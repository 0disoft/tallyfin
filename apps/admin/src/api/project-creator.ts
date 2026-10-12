import { ApiClient, ApiError } from './client.ts';
import { creationInput, initialCreationDraft } from './project-creation.ts';
import type { CreationDraft, CreationErrors, CreatedProject, ProjectCreation } from './project-creation.ts';
import type { ProjectSettings } from './types.ts';

export type CreatorState = { phase: 'ready' | 'creating' | 'uncertain' | 'created' | 'opening'; draft: CreationDraft;
  errors: CreationErrors; message: string | null; pending: ProjectCreation | null; receipt: CreatedProject | null };
/** One connection lifetime. No automatic creation retries; uncertain writes keep an immutable request. */
export class ProjectCreator {
  #initialDraft = initialCreationDraft();
  state: CreatorState = { phase: 'ready', draft: { ...this.#initialDraft }, errors: {}, message: null, pending: null, receipt: null };
  #listeners = new Set<(state: CreatorState) => void>();
  #client: ApiClient; #onOpened: (settings: ProjectSettings) => boolean | void;
  #controller: AbortController | null = null; #generation = 0; #destroyed = false;
  constructor(client: ApiClient, onOpened: (settings: ProjectSettings) => boolean | void) { this.#client = client; this.#onOpened = onOpened; }
  get hasUnsavedChanges(): boolean {
    if (this.#destroyed || this.state.receipt) return false;
    return this.state.phase === 'creating' || this.state.phase === 'uncertain' || this.state.pending !== null ||
      (Object.keys(this.#initialDraft) as (keyof CreationDraft)[]).some(key => this.state.draft[key] !== this.#initialDraft[key]);
  }
  subscribe(listener: (state: CreatorState) => void) {
    if (this.#destroyed) return () => {};
    this.#listeners.add(listener); this.#notify(() => listener(this.state));
    return () => { this.#listeners.delete(listener); };
  }
  #set(patch: Partial<CreatorState>) {
    if (this.#destroyed) return;
    const state = this.state = { ...this.state, ...patch };
    for (const listener of this.#listeners) this.#notify(() => listener(state));
  }
  // UI callbacks cannot change a confirmed server outcome or interrupt other subscribers.
  #notify(callback: () => void): boolean {
    if (this.#destroyed) return false;
    try { callback(); return true; } catch { return false; }
  }
  #start() { this.#controller?.abort(); const controller = new AbortController(); this.#controller = controller; return { controller, generation: ++this.#generation }; }
  #current(g: number) { return !this.#destroyed && g === this.#generation && !this.#controller?.signal.aborted; }
  edit(key: keyof CreationDraft, value: string) {
    if (this.#destroyed || this.state.phase !== 'ready') return;
    this.#set({ draft: { ...this.state.draft, [key]: value }, errors: {}, message: null });
  }
  async create() {
    if (this.#destroyed || this.state.phase !== 'ready') return;
    const { input, errors } = creationInput(this.state.draft);
    if (Object.keys(errors).length) { this.#set({ errors, message: '입력한 내용을 확인해 주세요.' }); return; }
    await this.#submit(input);
  }
  async confirm() { if (!this.#destroyed && this.state.phase === 'uncertain' && this.state.pending) await this.#submit(this.state.pending); }
  async #submit(input: ProjectCreation) {
    const { controller, generation } = this.#start();
    this.#set({ phase: 'creating', pending: structuredClone(input), errors: {}, message: null });
    if (!this.#current(generation)) return;
    try {
      const receipt = await this.#client.createProject(input, { signal: controller.signal });
      if (!this.#current(generation)) return;
      this.#set({ phase: 'created', receipt, pending: null, message: '프로젝트 생성을 확인했어요. 첫 스키마를 등록해 주세요.' });
      await this.open();
    } catch (error) {
      if (!this.#current(generation)) return;
      if (error instanceof ApiError && ['invalid_request', 'forbidden', 'unauthorized', 'project_conflict', 'project_limit_reached'].includes(error.kind)) {
        this.#set({ phase: 'ready', pending: null, message: error.kind === 'forbidden'
          ? '프로젝트 owner와 별개로 생성 권한이 필요해요. 운영자에게 생성 권한을 확인해 주세요.' : error.message,
          errors: error.kind === 'project_conflict' ? { id: '이미 사용 중이거나 다른 내용으로 생성된 ID예요. 다른 ID를 입력해 주세요.' } : {} });
      } else this.#set({ phase: 'uncertain', message: '생성 결과를 확인하지 못했어요. 입력은 보존했어요. 같은 요청으로 생성 여부를 확인해 주세요.' });
    }
  }
  async open() {
    if (this.#destroyed || this.state.phase !== 'created' || !this.state.receipt) return;
    const id = this.state.receipt.projectId, { controller, generation } = this.#start();
    this.#set({ phase: 'opening' });
    if (!this.#current(generation)) return;
    try {
      const settings = await this.#client.getSettings(id, { signal: controller.signal });
      if (!this.#current(generation)) return;
      this.#set({ phase: 'created', message: '프로젝트 생성을 확인했어요. 첫 스키마를 등록해 주세요.' });
      if (!this.#current(generation)) return;
      let canceled = false;
      const notified = this.#notify(() => { canceled = this.#onOpened(settings) === false; });
      if (!this.#current(generation)) return;
      if (!notified)
        this.#set({ message: '생성한 프로젝트 화면을 열지 못했어요. 생성한 프로젝트 열기를 다시 눌러 주세요.' });
      else if (canceled)
        this.#set({ message: '프로젝트 생성은 완료됐어요. 화면 이동은 취소했어요. 준비되면 생성한 프로젝트 열기를 눌러 주세요.' });
    } catch { if (this.#current(generation)) this.#set({ phase: 'created', message: '생성은 확인했지만 프로젝트 설정을 불러오지 못했어요. 생성 요청을 다시 보내지 않고 설정만 조회해요.' }); }
  }
  destroy() { this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear(); }
}
