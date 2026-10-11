import { ApiClient, ApiError } from './client.ts';
import type { ProjectSettings, ProjectSettingsUpdate } from './types.ts';

export type SettingsDraft = { name: string; status: 'active' | 'paused'; origins: string;
  requestsPerMinute: string; newReceiptsPerUtcDay: string };
export type SettingsState = { phase: 'loading' | 'ready' | 'saving' | 'review' | 'error';
  snapshot: ProjectSettings | null; draft: SettingsDraft | null; latest: ProjectSettings | null;
  message: string | null; errors: Partial<Record<keyof SettingsDraft, string>>; blocked: boolean };
export function settingsDraft(settings: ProjectSettings): SettingsDraft {
  return { name: settings.project.name, status: settings.project.status, origins: settings.allowedOrigins.join('\n'),
    requestsPerMinute: String(settings.limits.requestsPerMinute), newReceiptsPerUtcDay: String(settings.limits.newReceiptsPerUtcDay) };
}
function differs(draft: SettingsDraft, snapshot: ProjectSettings): boolean {
  const original = settingsDraft(snapshot);
  return (Object.keys(original) as (keyof SettingsDraft)[]).some(key => original[key] !== draft[key]);
}
function buildUpdate(draft: SettingsDraft, snapshot: ProjectSettings): { update: ProjectSettingsUpdate; errors: SettingsState['errors'] } {
  const errors: SettingsState['errors'] = {};
  const name = draft.name.trim();
  if (!name || name.length > 80) errors.name = '프로젝트 이름을 1~80자로 입력해 주세요.';
  const origins = draft.origins.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (origins.length > 16 || new Set(origins).size !== origins.length) errors.origins = '허용 출처를 중복 없이 최대 16개 입력해 주세요.';
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (origin.length > 256 || url.origin !== origin || url.username || url.password || origin.includes('*') ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error();
    } catch { errors.origins = 'https://example.com처럼 경로 없이 정확한 출처를 입력해 주세요.'; }
  }
  const integer = (key: 'requestsPerMinute' | 'newReceiptsPerUtcDay', maximum: number) => {
    const value = Number(draft[key]);
    if (!/^\d+$/.test(draft[key]) || !Number.isSafeInteger(value) || value < 1 || value > maximum)
      errors[key] = `1~${maximum.toLocaleString('ko-KR')} 사이의 정수를 입력해 주세요.`;
    return value;
  };
  const requestsPerMinute = integer('requestsPerMinute', 600), newReceiptsPerUtcDay = integer('newReceiptsPerUtcDay', 1_000_000);
  const update: ProjectSettingsUpdate = { expectedSettingsHash: snapshot.settingsHash };
  if (name !== snapshot.project.name) update.name = name;
  if (draft.status !== snapshot.project.status) update.status = draft.status;
  if (JSON.stringify(origins) !== JSON.stringify(snapshot.allowedOrigins)) update.allowedOrigins = origins;
  const limits: NonNullable<ProjectSettingsUpdate['limits']> = {};
  if (requestsPerMinute !== snapshot.limits.requestsPerMinute) limits.requestsPerMinute = requestsPerMinute;
  if (newReceiptsPerUtcDay !== snapshot.limits.newReceiptsPerUtcDay) limits.newReceiptsPerUtcDay = newReceiptsPerUtcDay;
  if (Object.keys(limits).length) update.limits = limits;
  return { update, errors };
}

/** Owns one project/editor lifetime. Writes are never retried automatically. */
export class SettingsEditor {
  state: SettingsState = { phase: 'loading', snapshot: null, draft: null, latest: null, message: null, errors: {}, blocked: false };
  #listeners = new Set<(state: SettingsState) => void>();
  #controller: AbortController | null = null;
  #generation = 0;
  #destroyed = false;
  #client: ApiClient;
  #projectId: string;
  #onSaved: ((settings: ProjectSettings) => void) | undefined;
  #onAccessLost?: () => void;
  #knownOwner = false;
  constructor(client: ApiClient, projectId: string, onSaved?: (settings: ProjectSettings) => void, onAccessLost?: () => void) {
    this.#client = client; this.#projectId = projectId; this.#onSaved = onSaved; this.#onAccessLost = onAccessLost;
  }
  subscribe(listener: (state: SettingsState) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #set(state: SettingsState): void {
    if (this.#destroyed) return;
    this.state = state;
    for (const listener of this.#listeners) listener(state);
    // Old snapshots survive failed reads; they cannot restore a revoked role.
    const access = state.blocked ? false : state.phase === 'ready' ? state.snapshot?.canEdit : state.latest?.canEdit;
    if (access !== undefined) {
      const lost = this.#knownOwner && !access; this.#knownOwner = access;
      if (lost) this.#onAccessLost?.();
    }
  }
  #start(): { controller: AbortController; generation: number } {
    this.#controller?.abort();
    const controller = new AbortController(); this.#controller = controller;
    return { controller, generation: ++this.#generation };
  }
  #current(generation: number): boolean { return !this.#destroyed && generation === this.#generation && !this.#controller?.signal.aborted; }
  #accept(snapshot: ProjectSettings, message: string | null): void {
    this.#set({ phase: 'ready', snapshot, draft: settingsDraft(snapshot), latest: null, message, errors: {}, blocked: !snapshot.canEdit });
    this.#onSaved?.(snapshot);
  }
  async load(): Promise<void> { await this.#read(false); }
  async refresh(): Promise<void> {
    if (this.state.phase === 'saving') return;
    await this.#read(this.state.phase === 'review' || Boolean(this.state.snapshot && this.state.draft && differs(this.state.draft, this.state.snapshot)));
  }
  async checkLatest(): Promise<void> { if (this.state.phase !== 'saving') await this.#read(true); }
  async #read(preserve: boolean): Promise<void> {
    if (this.#destroyed) return;
    const { controller, generation } = this.#start();
    const previous = this.state;
    this.#set({ ...previous, phase: 'loading', latest: null, message: null, errors: {} });
    try {
      const snapshot = await this.#client.getSettings(this.#projectId, { signal: controller.signal });
      if (!this.#current(generation)) return;
      if (preserve && previous.draft && previous.snapshot) {
        this.#set({ ...previous, phase: 'review', latest: snapshot, blocked: !snapshot.canEdit, errors: {},
          message: '최신 설정을 가져왔어요. 입력한 값과 비교한 뒤 사용할 설정을 골라 주세요.' });
      } else this.#accept(snapshot, null);
    } catch (error) {
      if (!this.#current(generation)) return;
      const blocked = error instanceof ApiError && ['unauthorized', 'forbidden'].includes(error.kind);
      this.#set({ ...previous, phase: previous.snapshot ? 'review' : 'error', latest: null, blocked: previous.blocked || blocked,
        message: error instanceof ApiError ? error.message : '설정을 불러오지 못했어요. 다시 시도해 주세요.' });
    }
  }
  edit(key: keyof SettingsDraft, value: string): void {
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.blocked || !this.state.snapshot?.canEdit || !this.state.draft) return;
    if (key === 'status' && value !== 'active' && value !== 'paused') return;
    this.#set({ ...this.state, draft: { ...this.state.draft, [key]: value }, message: null, errors: {} });
  }
  reset(): void {
    if (this.state.phase !== 'ready' || !this.state.snapshot) return;
    this.#set({ ...this.state, draft: settingsDraft(this.state.snapshot), message: null, errors: {} });
  }
  async save(): Promise<void> {
    const { snapshot, draft } = this.state;
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.blocked || !snapshot?.canEdit || !draft) return;
    const { update, errors } = buildUpdate(draft, snapshot);
    if (Object.keys(errors).length) { this.#set({ ...this.state, errors, message: '입력한 값을 확인해 주세요.' }); return; }
    if (Object.keys(update).length === 1) { this.#set({ ...this.state, message: '변경한 설정이 없어요.' }); return; }
    const { controller, generation } = this.#start();
    this.#set({ ...this.state, phase: 'saving', errors: {}, message: null });
    try {
      const saved = await this.#client.updateSettings(this.#projectId, update, { signal: controller.signal });
      if (!this.#current(generation)) return;
      this.#accept(saved, '프로젝트 설정을 저장했어요.');
    } catch (error) {
      if (!this.#current(generation)) return;
      const kind = error instanceof ApiError ? error.kind : 'network';
      const denied = kind === 'forbidden' || kind === 'unauthorized';
      const review = kind !== 'invalid_request';
      this.#set({ ...this.state, phase: review ? 'review' : 'ready', latest: null, blocked: this.state.blocked || denied,
        message: denied ? '편집 권한을 확인할 수 없어요. 입력한 값은 보존했어요. 다시 연결하거나 최신 설정을 확인해 주세요.'
          : kind === 'settings_conflict' ? '다른 사람이 설정을 변경했어요. 입력한 값은 보존했어요. 최신 설정을 확인해 주세요.'
          : kind === 'invalid_request' ? '서버가 설정을 거부했어요. 입력값과 허용 출처를 확인해 주세요.'
          : '저장 결과를 확인하지 못했어요. 입력한 값은 보존했어요. 최신 설정을 확인한 뒤 다시 저장해 주세요.' });
    }
  }
  useServer(): void {
    if (this.state.phase === 'review' && this.state.latest) this.#accept(this.state.latest, '서버의 최신 설정을 사용해요.');
  }
  keepChanges(): void {
    const { latest, snapshot, draft } = this.state;
    if (this.state.phase !== 'review' || !latest?.canEdit || !snapshot || !draft) return;
    const previous = settingsDraft(snapshot), next = settingsDraft(latest);
    for (const key of Object.keys(previous) as (keyof SettingsDraft)[]) {
      if (draft[key] !== previous[key]) Object.assign(next, { [key]: draft[key] });
    }
    this.#set({ ...this.state, phase: 'ready', snapshot: latest, draft: next, latest: null, blocked: false, errors: {},
      message: '최신 설정에 내 변경을 적용했어요. 값을 검토한 뒤 저장해 주세요.' });
    this.#onSaved?.(latest);
  }
  destroy(): void {
    this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear();
  }
}
