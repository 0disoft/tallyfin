import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiClient } from './api/client.ts';
import { GrantList, type GrantListState } from './api/grant-list.ts';
import { GrantEditor, type GrantEditorState } from './api/grant-editor.ts';
import type { GrantChange, GrantRole } from './api/grants-contract.ts';
import GrantChangePanel from './GrantChangePanel.tsx';
import type { DraftExitRegistration } from './api/draft-exit-guard.ts';
import useUnloadWarning from './useUnloadWarning.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

export default function LiveGrants({ client, projectId, canView, timeZone, refreshTick, locked = false, onAccessLost, onSaved, registerDraft }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: number;
  locked?: boolean; onAccessLost?: () => void; onSaved?: () => void; registerDraft?: DraftExitRegistration<ApiClient>;
}) {
  const { t, locale } = useI18n();
  const messageText = useMessageText();
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; projectId: string; state: GrantListState } | null>(null);
  const [mutation, setMutation] = useState<{ client: ApiClient; projectId: string; state: GrantEditorState } | null>(null);
  const [lostScope, setLostScope] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [form, setForm] = useState<{ client: ApiClient; projectId: string; issuer: string; subject: string; role: GrantRole } | null>(null);
  const listRef = useRef<GrantList | null>(null), tickRef = useRef(refreshTick);
  const editorRef = useRef<GrantEditor | null>(null);
  const inputDirtyRef = useRef(false);
  const scopeRef = useRef<{ client: ApiClient; projectId: string } | null>(null);
  const renderedScope = useRef({ client, projectId }); renderedScope.current = { client, projectId };
  const callbacksRef = useRef(onAccessLost); callbacksRef.current = onAccessLost;
  const savedRef = useRef(onSaved); savedRef.current = onSaved;
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
        savedRef.current?.();
      },
    }); editorRef.current = editor;
    const removeExitCheck = registerDraft?.(client, projectId, () => current() && (inputDirtyRef.current || editor.hasUnsavedChanges));
    const unsubscribeEditor = editor.subscribe(state => { if (current()) setMutation({ ...scope, state }); });
    const unsubscribe = list.subscribe(state => {
      if (!current()) return;
      setSnapshot({ ...scope, state });
      if (state.denied) accessLost();
    });
    void list.refresh();
    return () => {
      unsubscribe(); unsubscribeEditor(); list.destroy(); editor.destroy(); removeExitCheck?.();
      if (scopeRef.current === scope) scopeRef.current = null;
      if (listRef.current === list) listRef.current = null;
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [client, projectId, canView, registerDraft]);
  useEffect(() => {
    if (tickRef.current === refreshTick) return;
    tickRef.current = refreshTick;
    // Recheck the list without discarding a reviewed or unresolved request.
    if (!['saving', 'uncertain'].includes(editorRef.current?.state.phase ?? 'idle')) {
      if (!editorRef.current?.hasUnsavedChanges) editorRef.current?.cancel();
      void listRef.current?.refresh();
    }
  }, [refreshTick]);
  const formatter = useMemo(() => {
    try { return new Intl.DateTimeFormat(locale, { timeZone, calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return null; }
  }, [timeZone, locale]);
  // Never render a previous connection/project snapshot, even before effect cleanup runs.
  const lost = lostScope?.client === client && lostScope.projectId === projectId;
  const visible = canView && !lost;
  const state = visible && snapshot?.client === client && snapshot.projectId === projectId ? snapshot.state : null;
  const write = visible && mutation?.client === client && mutation.projectId === projectId ? mutation.state : null;
  const loading = visible && (!state || state.phase === 'loading'), saving = write?.phase === 'saving', uncertain = write?.phase === 'uncertain';
  const actionsLocked = locked || loading || state?.phase !== 'ready' || Boolean(write && ['review', 'saving', 'uncertain', 'error', 'denied'].includes(write.phase));
  const values = form?.client === client && form.projectId === projectId ? form : { issuer: '', subject: '', role: 'reader' as GrantRole };
  inputDirtyRef.current = visible && (values.issuer !== '' || values.subject !== '' || values.role !== 'reader');
  useUnloadWarning(visible && (inputDirtyRef.current || Boolean(editorRef.current?.hasUnsavedChanges)));
  const edit = (key: 'issuer' | 'subject' | 'role', value: string) => {
    if (actionsLocked) return;
    setForm({ client, projectId, ...values, [key]: value } as NonNullable<typeof form>);
  };
  const prepare = (change: GrantChange) => { if (!actionsLocked && state?.data) editorRef.current?.prepare({ ...change, expectedRevision: state.data.grantRevision }); };
  const submit = (event: FormEvent) => { event.preventDefault(); prepare({ issuer: values.issuer, subject: values.subject, role: values.role, expectedRole: null }); };
  const reload = () => {
    if (saving || uncertain || locked) return;
    if (editorRef.current?.hasUnsavedChanges && !window.confirm(t('operations:grantsUnloadConfirm'))) return;
    editorRef.current?.cancel(); void listRef.current?.refresh();
  };
  useEffect(() => {
    if (write?.phase === 'review' || write?.phase === 'uncertain') confirmRef.current?.focus();
    else if (write?.phase === 'error' || write?.phase === 'success') cancelRef.current?.focus();
  }, [write?.phase]);
  return <section className="settings-section grants-section" aria-labelledby="project-grants-heading" aria-busy={loading || saving || undefined}>
    <div className="settings-head">
      <h3 id="project-grants-heading" className="settings-subheading">{t('operations:grantsHeading')}</h3>
      <span className="settings-badge">{t('operations:ownerOnlyBadge')}</span>
      {visible && <div className="grants-actions">
        <button className="secondary-button" type="button" disabled={loading || saving || uncertain || locked} onClick={reload}>{t('operations:reloadFromStart')}</button>
        <button className="secondary-button" type="button" disabled={actionsLocked || !state?.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>{t('operations:nextPage')}</button>
      </div>}
    </div>
    <p className="context-note">{t('operations:grantsIntro')}</p>
    {!visible && <p className="notice" role="status">{t(lost ? 'operations:grantsLost' : 'operations:grantsNoAccess')}</p>}
    {visible && <>
      <details className="grant-add-disclosure"><summary ref={addSummaryRef}>{t('operations:grantsAdd')}</summary>
        <form className="grant-add-form" onSubmit={submit}>
          <p className="context-note" id="grant-add-help">{t('operations:grantsAddHelp')}</p>
          <label className="api-field" htmlFor="grant-add-issuer"><span>{t('operations:grantsIssuerLabel')}</span><input className="text-input" id="grant-add-issuer" type="url" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="grant-add-help" value={values.issuer} disabled={actionsLocked} onChange={e => edit('issuer', e.target.value)} /></label>
          <label className="api-field" htmlFor="grant-add-subject"><span>{t('operations:grantsSubjectLabel')}</span><input className="text-input" id="grant-add-subject" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="grant-add-help" value={values.subject} disabled={actionsLocked} onChange={e => edit('subject', e.target.value)} /></label>
          <label className="api-field" htmlFor="grant-add-role"><span>{t('operations:grantsRoleSelect')}</span><select className="text-input settings-select" id="grant-add-role" value={values.role} disabled={actionsLocked} onChange={e => edit('role', e.target.value)}><option value="reader">{t('operations:roleReader')}</option><option value="owner">{t('operations:roleOwner')}</option></select></label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={actionsLocked}>{t('operations:grantsReviewAdd')}</button></div>
        </form>
      </details>
      {write && <GrantChangePanel state={write} saving={saving} uncertain={uncertain} listLoading={loading} locked={locked || (state?.phase !== 'ready' && !uncertain)} confirmRef={confirmRef} cancelRef={cancelRef}
        onConfirm={() => { if (uncertain || (!locked && state?.phase === 'ready')) void editorRef.current?.confirm(); }}
        onCancel={() => { if (write.phase === 'error' && write.change) reload(); else editorRef.current?.cancel(); addSummaryRef.current?.focus(); }} onReload={reload} />}
    </>}
    {loading && <p className="context-note" role="status">{t('operations:grantsLoading')}</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{messageText(state.message)}</p>
      {!state.denied && <button className="secondary-button" type="button" disabled={saving || uncertain || locked} onClick={() => { void listRef.current?.retry(); }}>{t('operations:retryPage')}</button>}
    </div>}
    {state?.phase === 'ready' && state.data && <>
      <p className="context-note" role="status">{t('operations:grantsPage', { page: state.pageNumber, count: state.data.data.length })}{state.data.page.nextCursor === null ? t('operations:lastPage') : ''}{t('operations:grantsRegisteredAt', { timeZone })}</p>
      {state.data.data.length === 0 ? <p className="notice">{t('operations:grantsEmpty')}</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label={t('operations:grantsTableLabel')}>
          <table className="event-table grants-table">
            <caption className="sr-only">{t('operations:grantsTableCaption')}</caption>
            <thead><tr><th scope="col">{t('operations:grantsSubjectColumn')}</th><th scope="col">{t('operations:grantsIssuerColumn')}</th><th scope="col">{t('operations:grantsRoleColumn')}</th><th scope="col">{t('operations:grantsCreatedColumn')}</th><th scope="col">{t('operations:grantsChangeColumn')}</th></tr></thead>
            <tbody>{state.data.data.map(grant => <tr key={JSON.stringify([grant.issuer, grant.subject])}>
              <th scope="row">{grant.subject}</th><td>{grant.issuer}</td>
              <td><span className="settings-badge grant-role">{grant.role === 'owner' ? t('operations:roleOwner') : t('operations:roleReader')}</span></td>
              <td><time dateTime={grant.createdAt}>{formatter ? formatter.format(new Date(grant.createdAt)) : grant.createdAt}</time></td>
              <td><div className="grant-row-actions">
                <button className="secondary-button" type="button" disabled={actionsLocked} aria-label={t('operations:grantsRoleAria', { subject: grant.subject, action: grant.role === 'owner' ? t('operations:grantsMakeReader') : t('operations:grantsMakeOwner') })} onClick={() => prepare({ issuer: grant.issuer, subject: grant.subject, role: grant.role === 'owner' ? 'reader' : 'owner', expectedRole: grant.role })}>{grant.role === 'owner' ? t('operations:grantsMakeReader') : t('operations:grantsMakeOwner')}</button>
                <button className="secondary-button" type="button" disabled={actionsLocked} aria-label={t('operations:grantsRevokeAria', { subject: grant.subject })} onClick={() => prepare({ issuer: grant.issuer, subject: grant.subject, role: null, expectedRole: grant.role })}>{t('operations:grantsRevoke')}</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">{t('operations:grantsFooter')}</p>
    </>}
  </section>;
}
