import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiClient } from './api/client.ts';
import { PublisherList, type PublisherListState } from './api/publisher-list.ts';
import { PublisherEditor, type PublisherEditorState } from './api/publisher-editor.ts';
import type { PublisherRequest } from './api/publishers-contract.ts';
import PublisherChangePanel from './PublisherChangePanel.tsx';

/** Owner-only server publisher permission surface. The list and the single write follow the same conventions as LiveGrants. */
export default function LivePublishers({ client, projectId, canView, timeZone, refreshTick, locked = false, onAccessLost, onSaved, onBusyChange }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: number;
  locked?: boolean; onAccessLost?: () => void; onSaved?: () => void;
  /** Reports an in-flight or unresolved write so sibling surfaces can lock; the review step itself stays unlocked. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; projectId: string; state: PublisherListState } | null>(null);
  const [mutation, setMutation] = useState<{ client: ApiClient; projectId: string; state: PublisherEditorState } | null>(null);
  const [lostScope, setLostScope] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [form, setForm] = useState<{ client: ApiClient; projectId: string; issuer: string; subject: string } | null>(null);
  const listRef = useRef<PublisherList | null>(null), tickRef = useRef(refreshTick);
  const editorRef = useRef<PublisherEditor | null>(null);
  const scopeRef = useRef<{ client: ApiClient; projectId: string } | null>(null);
  const renderedScope = useRef({ client, projectId }); renderedScope.current = { client, projectId };
  const callbacksRef = useRef(onAccessLost); callbacksRef.current = onAccessLost;
  const savedRef = useRef(onSaved); savedRef.current = onSaved;
  const busyRef = useRef(onBusyChange); busyRef.current = onBusyChange;
  const confirmRef = useRef<HTMLButtonElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const addSummaryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!canView) { setSnapshot(null); setMutation(null); setForm(null); return; }
    const scope = { client, projectId }; scopeRef.current = scope;
    const current = () => scopeRef.current === scope && renderedScope.current.client === client && renderedScope.current.projectId === projectId;
    setLostScope(null); setForm({ ...scope, issuer: '', subject: '' });
    const list = new PublisherList(client, projectId); listRef.current = list;
    const accessLost = () => {
      if (!current()) return;
      setLostScope(scope); setSnapshot(null); setMutation(null); setForm(null);
      list.destroy(); editor.destroy(); callbacksRef.current?.();
    };
    const editor = new PublisherEditor(client, projectId, {
      onAccessLost: accessLost,
      onSaved: () => {
        if (!current()) return;
        setForm({ ...scope, issuer: '', subject: '' });
        void list.refresh();
        savedRef.current?.();
      },
    }); editorRef.current = editor;
    const unsubscribeEditor = editor.subscribe(state => { if (current()) setMutation({ ...scope, state }); });
    const unsubscribe = list.subscribe(state => {
      if (!current()) return;
      setSnapshot({ ...scope, state });
      if (state.denied) accessLost();
    });
    void list.refresh();
    return () => {
      unsubscribe(); unsubscribeEditor(); list.destroy(); editor.destroy();
      if (scopeRef.current === scope) scopeRef.current = null;
      if (listRef.current === list) listRef.current = null;
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [client, projectId, canView]);
  useEffect(() => {
    if (tickRef.current === refreshTick) return;
    tickRef.current = refreshTick;
    // A settings read cannot cancel a publisher write or discard an uncertain outcome.
    if (!['saving', 'uncertain'].includes(editorRef.current?.state.phase ?? 'idle')) {
      editorRef.current?.cancel(); void listRef.current?.refresh();
    }
  }, [refreshTick]);
  const formatter = useMemo(() => {
    try { return new Intl.DateTimeFormat('ko-KR', { timeZone, dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return null; }
  }, [timeZone]);
  // Never render a previous connection/project snapshot, even before effect cleanup runs.
  const lost = lostScope?.client === client && lostScope.projectId === projectId;
  const visible = canView && !lost;
  const state = visible && snapshot?.client === client && snapshot.projectId === projectId ? snapshot.state : null;
  const write = visible && mutation?.client === client && mutation.projectId === projectId ? mutation.state : null;
  const loading = visible && (!state || state.phase === 'loading'), saving = write?.phase === 'saving', uncertain = write?.phase === 'uncertain';
  // A pending or unresolved write locks the sibling settings surfaces; the local
  // review stays open so the same request can still be confirmed.
  const busy = saving || uncertain, reportedBusy = useRef(false);
  useEffect(() => {
    if (reportedBusy.current === busy) return;
    reportedBusy.current = busy; busyRef.current?.(busy);
  }, [busy]);
  useEffect(() => () => { if (reportedBusy.current) { reportedBusy.current = false; busyRef.current?.(false); } }, []);
  const actionsLocked = locked || loading || state?.phase !== 'ready' || Boolean(write && ['review', 'saving', 'uncertain', 'error', 'denied'].includes(write.phase));
  const values = form?.client === client && form.projectId === projectId ? form : { issuer: '', subject: '' };
  const edit = (key: 'issuer' | 'subject', value: string) => {
    if (actionsLocked) return;
    setForm({ client, projectId, ...values, [key]: value });
  };
  const prepare = (request: PublisherRequest) => { if (!actionsLocked) editorRef.current?.prepare(request); };
  const submit = (event: FormEvent) => { event.preventDefault(); prepare({ granted: true, issuer: values.issuer, subject: values.subject }); };
  const stamp = (value: string) => formatter ? formatter.format(new Date(value)) : value;
  const reload = () => {
    if (saving || uncertain || locked) return;
    editorRef.current?.cancel(); void listRef.current?.refresh();
  };
  useEffect(() => {
    if (write?.phase === 'review' || write?.phase === 'uncertain') confirmRef.current?.focus();
    else if (write?.phase === 'error' || write?.phase === 'success') cancelRef.current?.focus();
  }, [write?.phase]);
  return <section className="settings-section publishers-section" aria-labelledby="project-publishers-heading" aria-busy={loading || saving || undefined}>
    <div className="settings-head">
      <h3 id="project-publishers-heading" className="settings-subheading">서버 발행자</h3>
      <span className="settings-badge">소유자 전용</span>
      {visible && <div className="publishers-actions">
        <button className="secondary-button" type="button" disabled={loading || saving || uncertain || locked} onClick={reload}>처음부터 새로고침</button>
        <button className="secondary-button" type="button" disabled={actionsLocked || !state?.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>다음 페이지</button>
      </div>}
    </div>
    <p className="context-note">서버 발행은 이 목록의 계정만 허용해요. 관리자 조회·소유자 권한과 별개이고, 부여·회수는 확인 후 저장해요.</p>
    {!visible && <p className="notice" role="status">{lost ? '소유자 권한을 확인할 수 없어 목록과 변경 기능을 닫았어요. 최신 설정이나 연결을 확인해 주세요.' : '설정에서 소유자 권한을 확인하면 목록을 볼 수 있어요. 조회 권한으로 연결한 계정에는 목록을 표시하지 않아요.'}</p>}
    {visible && <>
      <details className="publishers-add-disclosure"><summary ref={addSummaryRef}>발행자 추가</summary>
        <form className="publishers-add-form" onSubmit={submit}>
          <p className="context-note" id="publisher-add-help">발행 서비스가 로그인에 쓰는 발급자(issuer)와 계정 식별자(sub)를 그대로 입력해요. 서버 발행 권한만 생기고 관리자 권한은 생기지 않아요.</p>
          <label className="api-field" htmlFor="publisher-add-issuer"><span>발급자 주소</span><input className="text-input" id="publisher-add-issuer" type="url" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="publisher-add-help" value={values.issuer} disabled={actionsLocked} onChange={e => edit('issuer', e.target.value)} /></label>
          <label className="api-field" htmlFor="publisher-add-subject"><span>계정 식별자</span><input className="text-input" id="publisher-add-subject" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="publisher-add-help" value={values.subject} disabled={actionsLocked} onChange={e => edit('subject', e.target.value)} /></label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={actionsLocked}>추가 내용 확인</button></div>
        </form>
      </details>
      {write && <PublisherChangePanel state={write} saving={saving} uncertain={uncertain} listLoading={loading}
        locked={locked || (state?.phase !== 'ready' && !uncertain)} confirmRef={confirmRef} cancelRef={cancelRef}
        onConfirm={() => { if (uncertain || (!locked && state?.phase === 'ready')) void editorRef.current?.confirm(); }}
        onCancel={() => { if (write.phase === 'error' && write.request) reload(); else editorRef.current?.cancel(); addSummaryRef.current?.focus(); }} onReload={reload} />}
    </>}
    {loading && <p className="context-note" role="status">발행자 목록을 불러오는 중이에요.</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{state.message}</p>
      {!state.denied && <button className="secondary-button" type="button" disabled={saving || uncertain || locked} onClick={() => { void listRef.current?.retry(); }}>이 페이지 다시 시도</button>}
    </div>}
    {state?.phase === 'ready' && state.data && <>
      <p className="context-note" role="status">{state.pageNumber}페이지 · 표시 중 {state.data.data.length}건{state.data.page.nextCursor === null ? ' · 마지막 페이지' : ''} · 등록 시각: {timeZone}</p>
      {state.data.data.length === 0 ? <p className="notice">이 페이지에 표시할 발행자가 없어요. 처음부터 새로고침하면 현재 목록을 다시 확인할 수 있어요.</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="서버 발행자 표">
          <table className="event-table publishers-table">
            <caption className="sr-only">현재 프로젝트의 서버 발행자 계정 식별자, 발급자, 등록 시각과 권한 회수</caption>
            <thead><tr><th scope="col">계정 식별자</th><th scope="col">발급자</th><th scope="col">등록 시각</th><th scope="col">변경</th></tr></thead>
            <tbody>{state.data.data.map(publisher => <tr key={JSON.stringify([publisher.issuer, publisher.subject])}>
              <th scope="row">{publisher.subject}</th><td>{publisher.issuer}</td>
              <td><time dateTime={publisher.createdAt}>{stamp(publisher.createdAt)}</time></td>
              <td><div className="publishers-row-actions">
                <button className="secondary-button" type="button" disabled={actionsLocked} aria-label={`${publisher.subject} 발행 권한 회수`}
                  onClick={() => prepare({ granted: false, issuer: publisher.issuer, subject: publisher.subject, expectedGrantId: publisher.grantId })}>발행 권한 회수</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">발급자와 식별자 순서로 25건씩 보여줘요. 좁은 화면에서는 표를 옆으로 밀어 권한 회수 버튼까지 볼 수 있어요. 앞쪽에 추가된 발행자는 처음부터 새로고침하면 보여요.</p>
    </>}
  </section>;
}
