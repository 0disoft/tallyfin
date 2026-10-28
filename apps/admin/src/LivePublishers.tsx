import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiClient } from './api/client.ts';
import { PublisherList, type PublisherListState } from './api/publisher-list.ts';
import { PublisherEditor, type PublisherEditorState } from './api/publisher-editor.ts';
import type { PublisherRequest } from './api/publishers-contract.ts';
import PublisherChangePanel from './PublisherChangePanel.tsx';
import type { DraftExitRegistration } from './api/draft-exit-guard.ts';
import useUnloadWarning from './useUnloadWarning.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

/** Owner-only server publisher permission surface. The list and the single write follow the same conventions as LiveGrants. */
export default function LivePublishers({ client, projectId, canView, timeZone, refreshTick, locked = false, onAccessLost, onSaved, onBusyChange, registerDraft }: {
  client: ApiClient; projectId: string; canView: boolean; timeZone: string; refreshTick: number;
  locked?: boolean; onAccessLost?: () => void; onSaved?: () => void;
  /** Reports an in-flight or unresolved write so sibling surfaces can lock; the review step itself stays unlocked. */
  onBusyChange?: (busy: boolean) => void;
  registerDraft?: DraftExitRegistration<ApiClient>;
}) {
  const { t, locale } = useI18n();
  const messageText = useMessageText();
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; projectId: string; state: PublisherListState } | null>(null);
  const [mutation, setMutation] = useState<{ client: ApiClient; projectId: string; state: PublisherEditorState } | null>(null);
  const [lostScope, setLostScope] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [form, setForm] = useState<{ client: ApiClient; projectId: string; issuer: string; subject: string } | null>(null);
  const listRef = useRef<PublisherList | null>(null), tickRef = useRef(refreshTick);
  const editorRef = useRef<PublisherEditor | null>(null);
  const inputDirtyRef = useRef(false);
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
  inputDirtyRef.current = visible && (values.issuer !== '' || values.subject !== '');
  useUnloadWarning(visible && (inputDirtyRef.current || Boolean(editorRef.current?.hasUnsavedChanges)));
  const edit = (key: 'issuer' | 'subject', value: string) => {
    if (actionsLocked) return;
    setForm({ client, projectId, ...values, [key]: value });
  };
  const prepare = (request: PublisherRequest) => { if (!actionsLocked) editorRef.current?.prepare(request); };
  const submit = (event: FormEvent) => { event.preventDefault(); prepare({ granted: true, issuer: values.issuer, subject: values.subject }); };
  const stamp = (value: string) => formatter ? formatter.format(new Date(value)) : value;
  const reload = () => {
    if (saving || uncertain || locked) return;
    if (editorRef.current?.hasUnsavedChanges && !window.confirm(t('operations:publishersUnloadConfirm'))) return;
    editorRef.current?.cancel(); void listRef.current?.refresh();
  };
  useEffect(() => {
    if (write?.phase === 'review' || write?.phase === 'uncertain') confirmRef.current?.focus();
    else if (write?.phase === 'error' || write?.phase === 'success') cancelRef.current?.focus();
  }, [write?.phase]);
  return <section className="settings-section publishers-section" aria-labelledby="project-publishers-heading" aria-busy={loading || saving || undefined}>
    <div className="settings-head">
      <h3 id="project-publishers-heading" className="settings-subheading">{t('operations:publishersHeading')}</h3>
      <span className="settings-badge">{t('operations:ownerOnlyBadge')}</span>
      {visible && <div className="publishers-actions">
        <button className="secondary-button" type="button" disabled={loading || saving || uncertain || locked} onClick={reload}>{t('operations:reloadFromStart')}</button>
        <button className="secondary-button" type="button" disabled={actionsLocked || !state?.data?.page.nextCursor}
          onClick={() => { void listRef.current?.next(); }}>{t('operations:nextPage')}</button>
      </div>}
    </div>
    <p className="context-note">{t('operations:publishersIntro')}</p>
    {!visible && <p className="notice" role="status">{t(lost ? 'operations:publishersLost' : 'operations:publishersNoAccess')}</p>}
    {visible && <>
      <details className="publishers-add-disclosure"><summary ref={addSummaryRef}>{t('operations:publishersAdd')}</summary>
        <form className="publishers-add-form" onSubmit={submit}>
          <p className="context-note" id="publisher-add-help">{t('operations:publishersAddHelp')}</p>
          <label className="api-field" htmlFor="publisher-add-issuer"><span>{t('operations:grantsIssuerLabel')}</span><input className="text-input" id="publisher-add-issuer" type="url" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="publisher-add-help" value={values.issuer} disabled={actionsLocked} onChange={e => edit('issuer', e.target.value)} /></label>
          <label className="api-field" htmlFor="publisher-add-subject"><span>{t('operations:grantsSubjectLabel')}</span><input className="text-input" id="publisher-add-subject" maxLength={512} required autoComplete="off" spellCheck={false} aria-describedby="publisher-add-help" value={values.subject} disabled={actionsLocked} onChange={e => edit('subject', e.target.value)} /></label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={actionsLocked}>{t('operations:publishersReviewAdd')}</button></div>
        </form>
      </details>
      {write && <PublisherChangePanel state={write} saving={saving} uncertain={uncertain} listLoading={loading}
        locked={locked || (state?.phase !== 'ready' && !uncertain)} confirmRef={confirmRef} cancelRef={cancelRef}
        onConfirm={() => { if (uncertain || (!locked && state?.phase === 'ready')) void editorRef.current?.confirm(); }}
        onCancel={() => { if (write.phase === 'error' && write.request) reload(); else editorRef.current?.cancel(); addSummaryRef.current?.focus(); }} onReload={reload} />}
    </>}
    {loading && <p className="context-note" role="status">{t('operations:publishersLoading')}</p>}
    {state?.phase === 'error' && <div role="alert">
      <p className="form-error">{messageText(state.message)}</p>
      {!state.denied && <button className="secondary-button" type="button" disabled={saving || uncertain || locked} onClick={() => { void listRef.current?.retry(); }}>{t('operations:retryPage')}</button>}
    </div>}
    {state?.phase === 'ready' && state.data && <>
      <p className="context-note" role="status">{t('operations:publishersPage', { page: state.pageNumber, count: state.data.data.length })}{state.data.page.nextCursor === null ? t('operations:lastPage') : ''}{t('operations:publishersRegisteredAt', { timeZone })}</p>
      {state.data.data.length === 0 ? <p className="notice">{t('operations:publishersEmpty')}</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label={t('operations:publishersTableLabel')}>
          <table className="event-table publishers-table">
            <caption className="sr-only">{t('operations:publishersTableCaption')}</caption>
            <thead><tr><th scope="col">{t('operations:publishersSubjectColumn')}</th><th scope="col">{t('operations:publishersIssuerColumn')}</th><th scope="col">{t('operations:publishersCreatedColumn')}</th><th scope="col">{t('operations:publishersChangeColumn')}</th></tr></thead>
            <tbody>{state.data.data.map(publisher => <tr key={JSON.stringify([publisher.issuer, publisher.subject])}>
              <th scope="row">{publisher.subject}</th><td>{publisher.issuer}</td>
              <td><time dateTime={publisher.createdAt}>{stamp(publisher.createdAt)}</time></td>
              <td><div className="publishers-row-actions">
                <button className="secondary-button" type="button" disabled={actionsLocked} aria-label={t('operations:publishersRevokeAria', { subject: publisher.subject })}
                  onClick={() => prepare({ granted: false, issuer: publisher.issuer, subject: publisher.subject, expectedGrantId: publisher.grantId })}>{t('operations:publishersRevoke')}</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <p className="context-note">{t('operations:publishersFooter')}</p>
    </>}
  </section>;
}
