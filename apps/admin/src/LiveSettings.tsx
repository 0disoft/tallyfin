// Live project settings editor for the API-connected admin console.
// This component owns no server state. The parent-provided SettingsEditor
// controller holds the snapshot, draft, phase and errors; this file renders
// that state, forwards edits, and keeps the draft visible when a save hits a
// conflict or a lost response so the user can compare and choose.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import type { ApiClient } from './api/client.ts';
import type { ProjectSettings, Registry } from './api/types.ts';
import { SettingsEditor, settingsDraft, type SettingsDraft, type SettingsState } from './api/settings-editor.ts';
import LiveGrants from './LiveGrants.tsx';
import LivePublishers from './LivePublishers.tsx';
import LiveAdminChanges from './LiveAdminChanges.tsx';

export type LiveSettingsProps = {
  client: ApiClient;
  projectId: string;
  onSaved: (settings: ProjectSettings) => void;
  refreshTick: number;
  registry?: Registry | null;
  onAccessLost?: () => void;
};

const FIELD_ORDER: (keyof SettingsDraft)[] = ['name', 'status', 'origins', 'requestsPerMinute', 'newReceiptsPerUtcDay'];

const FIELD_ID: Record<keyof SettingsDraft, string> = {
  name: 'settings-name',
  status: 'settings-status',
  origins: 'settings-origins',
  requestsPerMinute: 'settings-requests-per-minute',
  newReceiptsPerUtcDay: 'settings-new-receipts-per-utc-day',
};

const STATUS_LABEL: Record<'active' | 'paused', string> = { active: '수집 중', paused: '일시정지' };

function firstErrorKey(errors: SettingsState['errors'] | null | undefined): keyof SettingsDraft | null {
  if (!errors) return null;
  return FIELD_ORDER.find(key => Boolean(errors[key])) ?? null;
}

function describedBy(key: keyof SettingsDraft, errors: SettingsState['errors'] | null, help: boolean): string | undefined {
  const ids = [
    help ? `${FIELD_ID[key]}-help` : null,
    errors?.[key] ? `${FIELD_ID[key]}-error` : null,
  ].filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function displayValue(value: string): string {
  return value.length > 0 ? value : '—';
}

export function LiveSettings({ client, projectId, onSaved, refreshTick, registry = null, onAccessLost }: LiveSettingsProps) {
  const [snapshotState, setSnapshotState] = useState<{ client: ApiClient; projectId: string; state: SettingsState } | null>(null);
  const state = snapshotState?.client === client && snapshotState.projectId === projectId ? snapshotState.state : null;
  const editorRef = useRef<SettingsEditor | null>(null);
  const activeScope = useRef({ client, projectId });
  activeScope.current = { client, projectId };
  const accessCallbackRef = useRef(onAccessLost); accessCallbackRef.current = onAccessLost;
  const [grantLoss, setGrantLoss] = useState<{ client: ApiClient; projectId: string; snapshot: ProjectSettings | null } | null>(null);
  const [publisherBusy, setPublisherBusy] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const settingsSaved = useCallback((settings: ProjectSettings) => {
    if (activeScope.current.client !== client || activeScope.current.projectId !== projectId) return;
    setHistoryRevision(value => value + 1); onSaved(settings);
  }, [client, projectId, onSaved]);
  const grantsSaved = useCallback(() => {
    if (activeScope.current.client === client && activeScope.current.projectId === projectId) setHistoryRevision(value => value + 1);
  }, [client, projectId]);
  const publishersSaved = useCallback(() => {
    if (activeScope.current.client === client && activeScope.current.projectId === projectId) setHistoryRevision(value => value + 1);
  }, [client, projectId]);
  // A publisher write locks the settings form and the grant editor until it
  // resolves; the publisher section itself keeps its own review confirmable.
  const publisherBusyChange = useCallback((busy: boolean) => setPublisherBusy(busy ? { client, projectId } : null), [client, projectId]);
  const tickRef = useRef(refreshTick);
  const lastErrorRef = useRef<keyof SettingsDraft | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const originsRef = useRef<HTMLTextAreaElement>(null);
  const requestsPerMinuteRef = useRef<HTMLInputElement>(null);
  const newReceiptsRef = useRef<HTMLInputElement>(null);
  const inputRefs: Record<keyof SettingsDraft, RefObject<HTMLElement | null>> = {
    name: nameRef,
    status: statusRef,
    origins: originsRef,
    requestsPerMinute: requestsPerMinuteRef,
    newReceiptsPerUtcDay: newReceiptsRef,
  };

  // Rebuild the controller on mount and whenever the client or project
  // changes. StrictMode cleanup/replay creates and disposes it cleanly.
  useEffect(() => {
    const editor = new SettingsEditor(client, projectId, settingsSaved, () => {
      if (activeScope.current.client === client && activeScope.current.projectId === projectId) accessCallbackRef.current?.();
    });
    editorRef.current = editor;
    const unsubscribe = editor.subscribe(state => setSnapshotState({ client, projectId, state }));
    void editor.load();
    return () => {
      unsubscribe();
      editor.destroy();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [client, projectId, settingsSaved]);

  // A refreshTick bump re-reads the settings. The first render is skipped so
  // mounting does not fire a second request on top of load().
  useEffect(() => {
    if (tickRef.current === refreshTick) return;
    tickRef.current = refreshTick;
    void editorRef.current?.refresh();
  }, [refreshTick]);

  const errorKey = firstErrorKey(state?.errors);
  useEffect(() => {
    if (errorKey && errorKey !== lastErrorRef.current) inputRefs[errorKey].current?.focus();
    lastErrorRef.current = errorKey;
  });

  const phase = state?.phase ?? 'loading';
  const snapshot = state?.snapshot ?? null;
  const draft = state?.draft ?? null;
  const errors = state?.errors ?? null;
  const blocked = Boolean(state?.blocked);
  const saving = phase === 'saving';
  const loading = phase === 'loading';
  const reviewing = phase === 'review';
  const loaded = Boolean(snapshot && draft);
  // Read/write follows the server grant; a reader stays read-only.
  const lost = grantLoss?.client === client && grantLoss.projectId === projectId;
  const publishersBusy = publisherBusy?.client === client && publisherBusy.projectId === projectId;
  const freshOwner = phase === 'ready' && snapshot?.canEdit === true && snapshot !== grantLoss?.snapshot;
  const canEdit = snapshot?.canEdit === true && state?.latest?.canEdit !== false && (!lost || freshOwner);
  const accessLost = useCallback(() => {
    if (activeScope.current.client !== client || activeScope.current.projectId !== projectId) return;
    setGrantLoss({ client, projectId, snapshot });
    void editorRef.current?.checkLatest();
    accessCallbackRef.current?.();
  }, [client, projectId, snapshot]);
  useEffect(() => { if (lost && freshOwner) setGrantLoss(null); }, [lost, freshOwner]);
  // Inputs unlock only in the ready phase for an owner with no lock.
  const inputsLocked = phase !== 'ready' || blocked || !canEdit || publishersBusy;
  const canSubmit = loaded && phase === 'ready' && canEdit && !blocked && !publishersBusy;
  // The recovery panel covers a save conflict or a lost response. A pure reader
  // has nothing to recover, so it stays hidden for read-only grants.
  const showRecovery = reviewing || (blocked && canEdit);

  const edit = (key: keyof SettingsDraft, value: string) => editorRef.current?.edit(key, value);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    void editorRef.current?.save();
  };

  if (!state || (!loaded && phase !== 'error')) {
    return <section className="state-panel" role="status" aria-busy="true">
      <h2>설정을 불러오는 중이에요</h2>
      <p>서버에서 현재 프로젝트 설정을 읽어와요.</p>
    </section>;
  }

  if (!loaded) {
    return <section className="state-panel" role="alert">
      <WarningCircle size={32} />
      <h2>설정을 불러오지 못했어요</h2>
      <p>{state.message ?? '네트워크나 서버 상태를 확인한 뒤 다시 시도해 주세요.'}</p>
      <div className="state-actions"><button className="secondary-button" type="button" onClick={() => { void editorRef.current?.load(); }}>다시 시도</button></div>
    </section>;
  }

  const activeSnapshot = snapshot as ProjectSettings;
  const activeDraft = draft as SettingsDraft;

  return <section className="settings-section" aria-labelledby="live-settings-heading">
    <div className="settings-head">
      <h2 id="live-settings-heading">프로젝트 설정</h2>
      {(saving || loading) && <span className="settings-badge" role="status">{saving ? '저장 중…' : '불러오는 중…'}</span>}
      {!canEdit && <span className="settings-badge">읽기 전용</span>}
    </div>
    <p className="context-note">이름·상태·허용 출처·수집 한도를 바꿔요. 저장하면 서버 값이 갱신돼요.</p>
    <dl className="settings-source">
      <div><dt>프로젝트 ID</dt><dd>{activeSnapshot.project.id}</dd></div>
      <div><dt>시간대</dt><dd>{activeSnapshot.project.timeZone}</dd></div>
    </dl>
    {!canEdit && <p className="notice" role="status">조회 권한으로 연결했어요. 설정을 바꾸려면 프로젝트 소유자 권한이 필요해요.</p>}
    {state.message && !showRecovery && <p className="settings-message" role="status">{state.message}</p>}

    {showRecovery && <section className="settings-recovery" aria-label="설정 충돌 확인">
      <p className="settings-recovery-message" role="status">{state.message ?? '입력한 값을 그대로 뒀어요. 저장을 잠갔으니 최신 설정을 확인한 뒤 선택해 주세요.'}</p>
      <button className="secondary-button" type="button" disabled={loading || saving} onClick={() => { void editorRef.current?.checkLatest(); }}>최신 설정 확인</button>
      {reviewing && state.latest ? <>
        <ComparisonTable latest={state.latest} draft={activeDraft} />
        <div className="form-actions">
          <button className="primary-button" type="button" onClick={() => editorRef.current?.useServer()}>서버 설정 사용</button>
          <button className="secondary-button" type="button" onClick={() => editorRef.current?.keepChanges()} disabled={!state.latest.canEdit}>내 변경 유지하고 검토</button>
        </div>
      </> : null}
    </section>}

    <form className="settings-form" onSubmit={submit} aria-busy={saving || loading || undefined} noValidate>
      <div className="settings-field">
        <label className="field-label" htmlFor={FIELD_ID.name}>프로젝트 이름</label>
        <input id={FIELD_ID.name} ref={nameRef} className="text-input" type="text" autoComplete="off" maxLength={80} value={activeDraft.name} disabled={inputsLocked} onChange={event => edit('name', event.target.value)} aria-invalid={errors?.name ? true : undefined} aria-describedby={describedBy('name', errors, true)} />
        <p id={`${FIELD_ID.name}-help`} className="field-help">1~80자.</p>
        {errors?.name && <p id={`${FIELD_ID.name}-error`} className="form-error" role="alert">{errors.name}</p>}
      </div>

      <div className="settings-field">
        <label className="field-label" htmlFor={FIELD_ID.status}>상태</label>
        <select id={FIELD_ID.status} ref={statusRef} className="text-input settings-select" value={activeDraft.status} disabled={inputsLocked} onChange={event => edit('status', event.target.value)} aria-invalid={errors?.status ? true : undefined} aria-describedby={describedBy('status', errors, true)}>
          <option value="active">{STATUS_LABEL.active}</option>
          <option value="paused">{STATUS_LABEL.paused}</option>
        </select>
        <p id={`${FIELD_ID.status}-help`} className="field-help">수집 중 또는 일시정지 중 하나를 골라요.</p>
        {errors?.status && <p id={`${FIELD_ID.status}-error`} className="form-error" role="alert">{errors.status}</p>}
      </div>

      <div className="settings-field">
        <label className="field-label" htmlFor={FIELD_ID.origins}>허용 출처</label>
        <textarea id={FIELD_ID.origins} ref={originsRef} className="text-input settings-textarea" rows={5} spellCheck={false} value={activeDraft.origins} disabled={inputsLocked} onChange={event => edit('origins', event.target.value)} aria-invalid={errors?.origins ? true : undefined} aria-describedby={describedBy('origins', errors, true)} />
        <p id={`${FIELD_ID.origins}-help`} className="field-help">브라우저 출처를 한 줄에 하나씩, 최대 16개. 비워 두면 브라우저 수집이 차단돼요. 서버 발행에는 이 목록을 사용하지 않아요.</p>
        {errors?.origins && <p id={`${FIELD_ID.origins}-error`} className="form-error" role="alert">{errors.origins}</p>}
      </div>

      <div className="settings-field">
        <label className="field-label" htmlFor={FIELD_ID.requestsPerMinute}>분당 요청 한도</label>
        <input id={FIELD_ID.requestsPerMinute} ref={requestsPerMinuteRef} className="text-input" type="text" inputMode="numeric" pattern="[0-9]*" value={activeDraft.requestsPerMinute} disabled={inputsLocked} onChange={event => edit('requestsPerMinute', event.target.value)} aria-invalid={errors?.requestsPerMinute ? true : undefined} aria-describedby={describedBy('requestsPerMinute', errors, true)} />
        <p id={`${FIELD_ID.requestsPerMinute}-help`} className="field-help">1~600 사이 정수.</p>
        {errors?.requestsPerMinute && <p id={`${FIELD_ID.requestsPerMinute}-error`} className="form-error" role="alert">{errors.requestsPerMinute}</p>}
      </div>

      <div className="settings-field">
        <label className="field-label" htmlFor={FIELD_ID.newReceiptsPerUtcDay}>UTC 하루 신규 수신 한도</label>
        <input id={FIELD_ID.newReceiptsPerUtcDay} ref={newReceiptsRef} className="text-input" type="text" inputMode="numeric" pattern="[0-9]*" value={activeDraft.newReceiptsPerUtcDay} disabled={inputsLocked} onChange={event => edit('newReceiptsPerUtcDay', event.target.value)} aria-invalid={errors?.newReceiptsPerUtcDay ? true : undefined} aria-describedby={describedBy('newReceiptsPerUtcDay', errors, true)} />
        <p id={`${FIELD_ID.newReceiptsPerUtcDay}-help`} className="field-help">1~1,000,000 사이 정수, UTC 날짜 기준.</p>
        {errors?.newReceiptsPerUtcDay && <p id={`${FIELD_ID.newReceiptsPerUtcDay}-error`} className="form-error" role="alert">{errors.newReceiptsPerUtcDay}</p>}
      </div>

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={!canSubmit}>{saving ? '저장 중…' : '변경 저장'}</button>
        <button className="secondary-button" type="button" disabled={inputsLocked} onClick={() => editorRef.current?.reset()}>편집 초기화</button>
      </div>
    </form>

    <LiveGrants client={client} projectId={projectId} timeZone={activeSnapshot.project.timeZone} refreshTick={refreshTick}
      canView={canEdit && !blocked} locked={loading || saving || reviewing || publishersBusy} onAccessLost={accessLost} onSaved={grantsSaved} />

    <LivePublishers client={client} projectId={projectId} timeZone={activeSnapshot.project.timeZone} refreshTick={refreshTick}
      canView={canEdit && !blocked} locked={loading || saving || reviewing} onAccessLost={accessLost} onSaved={publishersSaved}
      onBusyChange={publisherBusyChange} />

    <LiveAdminChanges client={client} projectId={projectId} timeZone={activeSnapshot.project.timeZone}
      refreshTick={`${refreshTick}:${historyRevision}`} canView={canEdit && !blocked}
      locked={loading || saving || reviewing} onAccessLost={accessLost} />

    {registry ? <>
      <p className="context-note">등록 정의 · 스키마 v{registry.schemaVersion} · {registry.schemaStatus === 'retired' ? '사용 중지' : '사용 중'}</p>
      <h3 className="settings-subheading">등록 이벤트</h3>
      <div className="table-scroll" tabIndex={0} aria-label="등록 이벤트 표"><table className="event-table"><thead><tr><th scope="col">이벤트</th><th scope="col">출처</th><th scope="col">허용 속성</th></tr></thead><tbody>{registry.events.map(definition => <tr key={definition.name}><th scope="row" className="event-name">{definition.name}<div className="event-label">{definition.label}</div></th><td>{definition.source}</td><td>{Object.keys(definition.properties).join(', ') || '—'}</td></tr>)}</tbody></table></div>
      <h3 className="settings-subheading">작업 흐름</h3>
      <div className="table-scroll" tabIndex={0} aria-label="작업 흐름 표"><table className="event-table"><thead><tr><th scope="col">흐름</th><th scope="col">시작</th><th scope="col">성공</th><th scope="col">실패</th></tr></thead><tbody>{registry.workflows.length === 0 ? <tr><th scope="row">—</th><td>—</td><td>—</td><td>—</td></tr> : registry.workflows.map(definition => <tr key={definition.id}><th scope="row" className="event-name">{definition.id}<div className="event-label">{definition.label}</div></th><td>{definition.startEvent}</td><td>{definition.successEvent}</td><td>{definition.failureEvent ?? '—'}</td></tr>)}</tbody></table></div>
    </> : <p className="context-note">등록 이벤트와 작업 흐름 표는 스키마 버전을 함께 조회했을 때 보여줘요. 설정 편집에는 영향이 없어요.</p>}
  </section>;
}

function ComparisonTable({ latest, draft }: { latest: ProjectSettings; draft: SettingsDraft }) {
  const server = settingsDraft(latest);
  const rows: { label: string; key: keyof SettingsDraft; format: (value: string) => string }[] = [
    { label: '이름', key: 'name', format: displayValue },
    { label: '상태', key: 'status', format: value => STATUS_LABEL[value as 'active' | 'paused'] ?? value },
    { label: '허용 출처', key: 'origins', format: displayValue },
    { label: '분당 요청 한도', key: 'requestsPerMinute', format: displayValue },
    { label: 'UTC 하루 신규 수신 한도', key: 'newReceiptsPerUtcDay', format: displayValue },
  ];
  return <div className="table-scroll" tabIndex={0} aria-label="최신 서버 설정과 내 입력 비교">
    <table className="event-table settings-diff">
      <caption className="sr-only">최신 서버 설정과 내 입력 비교</caption>
      <thead><tr><th scope="col">항목</th><th scope="col">최신 서버 설정</th><th scope="col">내 입력</th></tr></thead>
      <tbody>{rows.map(row => {
        const changed = server[row.key] !== draft[row.key];
        return <tr key={row.key} className={changed ? 'changed' : undefined}>
          <th scope="row" className="event-name">{row.label}{changed && <span className="settings-diff-flag">변경</span>}</th>
          <td>{row.format(server[row.key])}</td>
          <td>{row.format(draft[row.key])}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export default LiveSettings;
