import { ApiClient, ApiError } from './client.ts';
import type { ProjectSettings } from './types.ts';
import { canonicalDefinitions, readDraft, schemaDefinitions as definitions } from './schema-contract.ts';
import type { SchemaDraft, SchemaPage, SchemaValidation } from './schema-contract.ts';

type Snapshot = { settings: ProjectSettings; page: SchemaPage; definitions: SchemaDraft };
type Pending = { version: number; definitions: SchemaDraft };
export type SchemaState = {
  phase: 'loading' | 'ready' | 'validating' | 'publishing' | 'review' | 'error';
  snapshot: Snapshot | null; latest: Snapshot | null; draft: string; target: string;
  report: SchemaValidation | null; validatedKey: string | null; privacyReviewed: boolean;
  pending: Pending | null; message: string | null; formError: string | null; more: boolean; blocked: boolean;
};
const pretty = (d: SchemaDraft) => JSON.stringify(d, null, 2);
const nextVersion = (v: number | null) => (v ?? 0) >= 2147483647 ? '' : String((v ?? 0) + 1);
const message = (e: unknown) => e instanceof ApiError ? e.message : '요청을 완료하지 못했어요. 다시 확인해 주세요.';
const denied = (e: unknown) => e instanceof ApiError && ['unauthorized', 'forbidden'].includes(e.kind);

/** One project lifetime; edits are memory-only and publishing is never automatically retried. */
export class SchemaEditor {
  state: SchemaState = { phase: 'loading', snapshot: null, latest: null, draft: '', target: '', report: null,
    validatedKey: null, privacyReviewed: false, pending: null, message: null, formError: null, more: false, blocked: false };
  #listeners = new Set<(s: SchemaState) => void>();
  #controller: AbortController | null = null;
  #generation = 0; #destroyed = false;
  #draftBaseline = '';
  #client: ApiClient; #projectId: string;
  #knownOwner = false;
  #onAccessLost?: () => void;
  constructor(client: ApiClient, projectId: string, onAccessLost?: () => void) {
    this.#client = client; this.#projectId = projectId; this.#onAccessLost = onAccessLost;
  }
  subscribe(listener: (s: SchemaState) => void) {
    if (this.#destroyed) return () => {};
    this.#listeners.add(listener); this.#notify(() => listener(this.state));
    return () => { this.#listeners.delete(listener); };
  }
  #set(patch: Partial<SchemaState>, confirmedAccess?: boolean) {
    if (this.#destroyed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.#listeners) this.#notify(() => listener(this.state));
    // Only confirmed reads and explicit denial change the cross-section signal.
    // Loading/review snapshots must not re-arm it and cause refresh loops.
    const access = patch.blocked === true ? false : confirmedAccess;
    if (access !== undefined) {
      const lost = this.#knownOwner && !access; this.#knownOwner = access;
      if (lost) this.#notify(this.#onAccessLost);
    }
  }
  // UI callbacks cannot reclassify a confirmed server result or interrupt revocation.
  #notify(callback: (() => void) | undefined) {
    if (this.#destroyed) return;
    try { callback?.(); } catch { /* Preserve state without exposing UI error details. */ }
  }
  #start() { this.#controller?.abort(); const controller = new AbortController(); this.#controller = controller; return { controller, generation: ++this.#generation }; }
  #current(g: number) { return !this.#destroyed && g === this.#generation && !this.#controller?.signal.aborted; }
  get canEdit() { return !this.state.blocked && (this.state.latest ?? this.state.snapshot)?.settings.canEdit === true; }
  get hasDraftChanges() { return this.state.draft !== this.#draftBaseline; }
  get hasUnsavedChanges(): boolean {
    return !this.#destroyed && Boolean(this.state.snapshot && (this.hasDraftChanges ||
      this.state.target !== nextVersion(this.state.snapshot.page.latestVersion) || this.state.pending ||
      this.state.phase === 'publishing'));
  }
  #key() { return this.state.target + '\n' + this.state.draft; }
  #input(): { draft: SchemaDraft; version: number } | null {
    try {
      const draft = readDraft(this.state.draft), version = Number(this.state.target);
      if (!/^[1-9]\d{0,9}$/.test(this.state.target) || version > 2147483647 || version <= (this.state.snapshot?.page.latestVersion ?? 0)) throw Error();
      return { draft, version };
    } catch { this.#set({ formError: '최신 버전보다 큰 번호와 events·workflows 배열이 있는 JSON을 입력해 주세요. 정의는 32KiB 이하여야 해요.' }); return null; }
  }
  #accept(snapshot: Snapshot, notice: string | null) {
    this.#draftBaseline = pretty(snapshot.definitions);
    this.#set({ phase: 'ready', snapshot, latest: null, draft: pretty(snapshot.definitions), target: nextVersion(snapshot.page.latestVersion),
      report: null, validatedKey: null, privacyReviewed: false, pending: null, message: notice, formError: null, more: false, blocked: false }, snapshot.settings.canEdit);
  }
  async load() { await this.#read(false); }
  async refresh() {
    if (this.state.phase === 'publishing' || this.state.phase === 'validating' || this.state.more) return;
    const dirty = this.state.snapshot && (this.state.draft !== pretty(this.state.snapshot.definitions) || this.state.target !== nextVersion(this.state.snapshot.page.latestVersion));
    await this.#read(Boolean(dirty || this.state.pending || this.state.phase === 'review'));
  }
  async checkLatest() { if (this.state.phase === 'review') await this.#read(true); }
  async #read(preserve: boolean) {
    if (this.#destroyed) return;
    const previous = this.state, { controller, generation } = this.#start();
    this.#set({ phase: 'loading', latest: null, message: null, more: false });
    try {
      const [settings, page] = await Promise.all([this.#client.getSettings(this.#projectId, { signal: controller.signal }), this.#client.listSchemas(this.#projectId, { signal: controller.signal })]);
      const latestDefinitions = page.latestVersion === null ? { events: [], workflows: [] }
        : definitions(await this.#client.getSchema(this.#projectId, page.latestVersion, { signal: controller.signal }));
      const snapshot: Snapshot = { settings, page, definitions: latestDefinitions };
      if (!this.#current(generation)) return;
      if (preserve && previous.snapshot) {
        if (previous.pending) {
          let target: SchemaDraft | null = null;
          try { target = definitions(await this.#client.getSchema(this.#projectId, previous.pending.version, { signal: controller.signal })); }
          catch (error) { if (!(error instanceof ApiError && error.kind === 'not_found')) throw error; }
          if (!this.#current(generation)) return;
          if (target && canonicalDefinitions(target) === canonicalDefinitions(previous.pending.definitions)) {
            this.#draftBaseline = previous.draft;
            this.#set({ ...previous, phase: 'ready', snapshot, latest: null, pending: null, report: null, validatedKey: null, privacyReviewed: false, blocked: false,
              target: nextVersion(page.latestVersion), message: `v${previous.pending.version} 발행을 서버에서 확인했어요. 입력한 정의는 그대로 뒀어요.` }, settings.canEdit); return;
          }
        }
        this.#set({ ...previous, phase: 'review', latest: snapshot, message: '최신 서버 정의와 내 초안을 비교한 뒤 사용할 내용을 골라 주세요.', report: null, validatedKey: null, privacyReviewed: false, blocked: false }, settings.canEdit);
      } else this.#accept(snapshot, null);
    } catch (error) {
      if (!this.#current(generation)) return;
      this.#set({ ...previous, phase: previous.snapshot ? 'review' : 'error', latest: null, message: message(error),
        blocked: previous.blocked || denied(error), report: null, validatedKey: null, privacyReviewed: false });
    }
  }
  edit(field: 'draft' | 'target', value: string) {
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.more || !this.canEdit) return;
    this.#set({ [field]: value, report: null, validatedKey: null, privacyReviewed: false, message: null, formError: null });
  }
  setPrivacy(value: boolean) { if (this.state.phase === 'ready' && this.canEdit) this.#set({ privacyReviewed: value }); }
  async selectVersion(version: number, options: { discardDraft?: boolean } = {}) {
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.more) return;
    if (this.hasDraftChanges && options.discardDraft !== true) {
      this.#set({ message: '작성 중인 초안이 있어요. 버전을 불러오려면 초안 교체를 확인해 주세요.' }); return;
    }
    const { controller, generation } = this.#start(); this.#set({ phase: 'loading', message: null });
    try {
      const registry = await this.#client.getSchema(this.#projectId, version, { signal: controller.signal });
      if (this.#current(generation)) {
        this.#draftBaseline = pretty(definitions(registry));
        this.#set({ phase: 'ready', draft: this.#draftBaseline, report: null, validatedKey: null, privacyReviewed: false,
          message: `v${version} 정의를 불러왔어요${this.canEdit ? '. 변경 후 새 버전으로 발행할 수 있어요.' : '.'}` });
      }
    } catch (error) { if (this.#current(generation)) this.#set({ phase: denied(error) ? 'review' : 'ready', message: message(error),
      ...(denied(error) ? { blocked: true, latest: null, report: null, validatedKey: null, privacyReviewed: false } : {}) }); }
  }
  async loadMore() {
    const snapshot = this.state.snapshot, cursor = snapshot?.page.page.beforeVersion;
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.more || cursor == null || !snapshot) return;
    const { controller, generation } = this.#start(); this.#set({ more: true, message: null });
    try {
      const page = await this.#client.listSchemas(this.#projectId, { beforeVersion: cursor, signal: controller.signal });
      if (!this.#current(generation)) return;
      const seen = new Set(snapshot.page.data.map(r => r.schemaVersion));
      this.#set({ more: false, snapshot: { ...snapshot, page: { ...snapshot.page, data: [...snapshot.page.data, ...page.data.filter(r => !seen.has(r.schemaVersion))], page: page.page } } });
    } catch (error) { if (this.#current(generation)) this.#set({ more: false, message: message(error),
      ...(denied(error) ? { phase: 'review', blocked: true, latest: null, report: null, validatedKey: null, privacyReviewed: false } : {}) }); }
  }
  async validate() {
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.more || !this.canEdit) return;
    const input = this.#input(); if (!input) return;
    const key = this.#key(), { controller, generation } = this.#start(); this.#set({ phase: 'validating', validatedKey: null, privacyReviewed: false, message: null, formError: null });
    try {
      const report = await this.#client.validateSchema(this.#projectId, input.draft, { signal: controller.signal });
      if (this.#current(generation)) this.#set({ phase: 'ready', report, validatedKey: report.valid ? key : null,
        message: report.valid ? '정의 검증을 통과했어요. 개인정보 검토를 확인한 뒤 발행해 주세요.' : '정의 오류를 수정한 뒤 다시 검증해 주세요.' });
    } catch (error) { if (this.#current(generation)) this.#set({ phase: denied(error) ? 'review' : 'ready',
      blocked: this.state.blocked || denied(error), latest: null, message: denied(error)
        ? '편집 권한을 확인할 수 없어요. 초안은 보존했어요. 서버 상태를 확인한 뒤 다시 검토해 주세요.' : message(error),
      report: null, validatedKey: null, privacyReviewed: false }); }
  }
  async publish() {
    if (this.#destroyed || this.state.phase !== 'ready' || this.state.more || !this.canEdit || !this.state.privacyReviewed || this.state.validatedKey !== this.#key()) return;
    const input = this.#input(); if (!input || !this.state.snapshot) return;
    const { controller, generation } = this.#start();
    this.#set({ phase: 'publishing', pending: { version: input.version, definitions: input.draft }, message: null });
    try {
      const saved = await this.#client.publishSchema(this.#projectId, input.version, { ...input.draft, privacyReviewed: true,
        expectedLatestVersion: this.state.snapshot.page.latestVersion }, { signal: controller.signal });
      if (!this.#current(generation)) return;
      const snapshot = this.state.snapshot!;
      this.#draftBaseline = this.state.draft;
      this.#set({ phase: 'ready', pending: null, snapshot: { ...snapshot, definitions: input.draft,
        page: { ...snapshot.page, latestVersion: Math.max(saved.schemaVersion, snapshot.page.latestVersion ?? 0),
          ...(snapshot.page.latestActiveVersion !== undefined ? { latestActiveVersion: saved.schemaStatus === 'active'
            ? Math.max(saved.schemaVersion, snapshot.page.latestActiveVersion ?? 0) : snapshot.page.latestActiveVersion } : {}),
          data: [saved, ...snapshot.page.data.filter(r => r.schemaVersion !== saved.schemaVersion)] } },
        target: nextVersion(saved.schemaVersion), validatedKey: null, privacyReviewed: false, report: null,
        message: saved.schemaStatus === 'retired' ? `v${saved.schemaVersion}은 이미 발행된 사용 중지 버전이에요. 활성 상태로 바꾸지 않았어요.`
          : `v${saved.schemaVersion} 발행을 완료했어요. 제품 SDK의 사용 버전은 별도로 전환해 주세요.` });
    } catch (error) {
      if (!this.#current(generation)) return;
      if (error instanceof ApiError && error.kind === 'invalid_request') this.#set({ phase: 'ready', pending: null, validatedKey: null, privacyReviewed: false, message: message(error) });
      else this.#set({ phase: 'review', latest: null, validatedKey: null, privacyReviewed: false,
        blocked: this.state.blocked || denied(error), message: denied(error)
          ? '발행 권한을 확인할 수 없어요. 초안은 보존했어요. 서버 상태를 확인한 뒤 다시 검토해 주세요.'
          : '발행 결과를 확인하지 못했어요. 초안은 보존했어요. 서버 상태를 확인한 뒤 다시 검토해 주세요.' });
    }
  }
  useServer() { if (this.state.phase === 'review' && this.state.latest) this.#accept(this.state.latest, '서버의 최신 정의를 사용해요.'); }
  keepDraft() {
    if (this.state.phase !== 'review' || !this.state.latest?.settings.canEdit) return;
    this.#draftBaseline = pretty(this.state.latest.definitions);
    this.#set({ phase: 'ready', snapshot: this.state.latest, latest: null, pending: null, target: nextVersion(this.state.latest.page.latestVersion),
      report: null, validatedKey: null, privacyReviewed: false, blocked: false, message: '초안을 유지했어요. 새 버전 번호와 정의를 다시 검증한 뒤 발행해 주세요.' });
  }
  destroy() { this.#destroyed = true; ++this.#generation; this.#controller?.abort(); this.#listeners.clear(); }
}
