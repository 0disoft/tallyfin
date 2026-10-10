import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiClient } from './api/client.ts';
import { GrantList, type GrantListState } from './api/grant-list.ts';
import { GrantEditor, type GrantEditorState } from './api/grant-editor.ts';
import type { GrantChange, GrantRole } from './api/grants-contract.ts';
import GrantChangePanel from './GrantChangePanel.tsx';

export default function LiveGrants({ client, projectId, canView, timeZone, refreshTick, locked = false, onAccessLost }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: number;
  locked?: boolean; onAccessLost?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; projectId: string; state: GrantListState } | null>(null);
  const [mutation, setMutation] = useState<{ client: ApiClient; projectId: string; state: GrantEditorState } | null>(null);
  const [lostScope, setLostScope] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [form, setForm] = useState<{ client: ApiClient; projectId: string; issuer: string; subject: string; role: GrantRole } | null>(null);
  const listRef = useRef<GrantList | null>(null), tickRef = useRef(refreshTick);
  const editorRef = useRef<GrantEditor | null>(null);
  const scopeRef = useRef<{ client: ApiClient; projectId: string } | null>(null);
  const renderedScope = useRef({ client, projectId }); renderedScope.current = { client, projectId };
  const callbacksRef = useRef(onAccessLost); callbacksRef.current = onAccessLost;
  const confirmRef = useRef<HTMLButtonElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const addSummaryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!canView) { setSnapshot(null); setMutation(null); setForm(null); return; }
    const scope = { client, projectId }; scopeRef.current = scope;
    const current = () => scopeRef.current === scope && renderedScope.current.client === client && renderedScope.current.projectId === projectId;
    setLostScope(null); setForm({ ...scope, issuer: '', subject: '', role: 'reader' });
    const list = new GrantList(client, projectId); listRef.current = list;
    const accessLost = () => {
      if (!current()) return;
      setLostScope(scope); setSnapshot(null); setMutation(null); setForm(null);
      list.destroy(); editor.destroy(); callbacksRef.current?.();
    };
    const editor = new GrantEditor(client, projectId, {
      onAccessLost: accessLost,
      onSaved: result => {
        if (!current() || !result.canManage) return;
        setForm({ ...scope, issuer: '', subject: '', role: 'reader' });
        void list.refresh();
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
    // A settings read cannot cancel a grant write or discard an uncertain outcome.
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
  const actionsLocked = locked || loading || state?.phase !== 'ready' || Boolean(write && ['review', 'saving', 'uncertain', 'error', 'denied'].includes(write.phase));
  const values = form?.client === client && form.projectId === projectId ? form : { issuer: '', subject: '', role: 'reader' as GrantRole };
  const edit = (key: 'issuer' | 'subject' | 'role', value: string) => {
    if (actionsLocked) return;
    setForm({ client, projectId, ...values, [key]: value } as NonNullable<typeof form>);
  };
  const prepare = (change: GrantChange) => { if (!actionsLocked) editorRef.current?.prepare(change); };
  const submit = (event: FormEvent) => { event.preventDefault(); prepare({ issuer: values.issuer, subject: values.subject, role: values.role, expectedRole: null }); };
  const reload = () => {
    if (saving || uncertain || locked) return;
    editorRef.current?.cancel(); void listRef.current?.refresh();
  };
  useEffect(() => {
    if (write?.phase === 'review' || write?.phase === 'uncertain') confirmRef.current?.focus();
    else if (write?.phase === 'error' || write?.phase === 'success') cancelRef.current?.focus();
  }, [write?.phase]);
  return <section className="settings-section grants-section" aria-labelledby="project-grants-heading" aria-busy={loading || saving || undefined}>
    <div className="settings-head">
      <h3 id="project-grants-heading" className="settings-subheading">프로젝트 권한</h3>
      <span className="settings-badge">소유자 전용</span>
      {visible && <div className="grants-actions">
        <button className="secondary-button" type="button" disabled={loading || saving || uncertain || locked} onClick={reload}>처음부터 새로고침</button>
        <button className="secondary-button" type="button" disabled={actionsLocked || !state?.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>다음 페이지</button>
      </div>}
    </div>
    <p className="context-note">소유자는 계정을 추가하고 조회·소유자 역할을 바꾸거나 권한을 회수할 수 있어요. 모든 변경은 확인 후 저장해요.</p>
    {!visible && <p className="notice" role="status">{lost ? '소유자 권한을 확인할 수 없어 목록과 변경 기능을 닫았어요. 최신 설정이나 연결을 확인해 주세요.' : '설정에서 소유자 권한을 확인하면 목록을 볼 수 있어요. 조회 권한으로 연결한 계정에는 목록을 표시하지 않아요.'}</p>}
    {visible && <>
      <details className="grant-add-disclosure"><summary ref={addSummaryRef}>계정 권한 추가</summary>
        <form className="grant-add-form" onSubmit={submit}>
          <p className="context-note" id="grant-add-help">로그인 제공자의 발급자(issuer)와 계정 식별자(sub)를 그대로 입력해요. 이메일과 다를 수 있어요.</p>
          <label className="api-field" htmlFor="grant-add-issuer"><span>발급자 주소</span><input className="text-input" id="grant-add-issuer" type="url" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="grant-add-help" value={values.issuer} disabled={actionsLocked} onChange={e => edit('issuer', e.target.value)} /></label>
          <label className="api-field" htmlFor="grant-add-subject"><span>계정 식별자</span><input className="text-input" id="grant-add-subject" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="grant-add-help" value={values.subject} disabled={actionsLocked} onChange={e => edit('subject', e.target.value)} /></label>
          <label className="api-field" htmlFor="grant-add-role"><span>부여할 역할</span><select className="text-input settings-select" id="grant-add-role" value={values.role} disabled={actionsLocked} onChange={e => edit('role', e.target.value)}><option value="reader">조회</option><option value="owner">소유자</option></select></label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={actionsLocked}>추가 내용 확인</button></div>
        </form>
      </details>
      {write && <GrantChangePanel state={write} saving={saving} uncertain={uncertain} listLoading={loading} locked={locked || (state?.phase !== 'ready' && !uncertain)} confirmRef={confirmRef} cancelRef={cancelRef}
        onConfirm={() => { if (uncertain || (!locked && state?.phase === 'ready')) void editorRef.current?.confirm(); }}
        onCancel={() => { if (write.phase === 'error' && write.change) reload(); else editorRef.current?.cancel(); addSummaryRef.current?.focus(); }} onReload={reload} />}
    </>}
    {loading && <p className="context-note" role="status">권한 목록을 불러오는 중이에요.</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{state.message}</p>
      {!state.denied && <button className="secondary-button" type="button" disabled={saving || uncertain || locked} onClick={() => { void listRef.current?.retry(); }}>이 페이지 다시 시도</button>}
    </div>}
    {state?.phase === 'ready' && state.data && <>
      <p className="context-note" role="status">{state.pageNumber}페이지 · 표시 중 {state.data.data.length}건{state.data.page.nextCursor === null ? ' · 마지막 페이지' : ''} · 등록 시각: {timeZone}</p>
      {state.data.data.length === 0 ? <p className="notice">이 페이지에 표시할 권한이 없어요. 처음부터 새로고침하면 현재 목록을 다시 확인할 수 있어요.</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="프로젝트 권한 표">
          <table className="event-table grants-table">
            <caption className="sr-only">현재 프로젝트의 계정 식별자, 발급자, 권한, 등록 시각과 권한 변경</caption>
            <thead><tr><th scope="col">계정 식별자</th><th scope="col">발급자</th><th scope="col">권한</th><th scope="col">등록 시각</th><th scope="col">변경</th></tr></thead>
            <tbody>{state.data.data.map(grant => <tr key={JSON.stringify([grant.issuer, grant.subject])}>
              <th scope="row">{grant.subject}</th><td>{grant.issuer}</td>
              <td><span className="settings-badge grant-role">{grant.role === 'owner' ? '소유자' : '조회'}</span></td>
              <td><time dateTime={grant.createdAt}>{formatter ? formatter.format(new Date(grant.createdAt)) : grant.createdAt}</time></td>
              <td><div className="grant-row-actions">
                <button className="secondary-button" type="button" disabled={actionsLocked} aria-label={`${grant.subject} ${grant.role === 'owner' ? '조회로 변경' : '소유자로 변경'}`} onClick={() => prepare({ issuer: grant.issuer, subject: grant.subject, role: grant.role === 'owner' ? 'reader' : 'owner', expectedRole: grant.role })}>{grant.role === 'owner' ? '조회로 변경' : '소유자로 변경'}</button>
                <button className="secondary-button" type="button" disabled={actionsLocked} aria-label={`${grant.subject} 권한 회수`} onClick={() => prepare({ issuer: grant.issuer, subject: grant.subject, role: null, expectedRole: grant.role })}>권한 회수</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">발급자와 식별자 순서로 25건씩 보여줘요. 앞쪽에 추가된 권한은 처음부터 새로고침하면 보여요.</p>
    </>}
  </section>;
}
