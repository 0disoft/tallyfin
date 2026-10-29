import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import type { SchemaEditor } from './api/schema-editor.ts';
import { SavedDraftController, type SavedDraftState } from './api/saved-draft-controller.ts';
import { schemaDraftFile } from './api/schema-draft-file.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

const EMPTY: SavedDraftState = { phase: 'idle', snapshot: null, pending: null, confirmed: null, reviewRequired: false, error: null };

export default function ServerSchemaDraft({ client, projectId, editor, editable }: {
  client: ApiClient; projectId: string; editor: SchemaEditor; editable: boolean;
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [view, setView] = useState<{ client: ApiClient; projectId: string; editor: SchemaEditor; controller: SavedDraftController; state: SavedDraftState } | null>(null);
  const [notice, setNotice] = useState<'loadCancelled' | 'keptCurrent' | null>(null);
  const scope = view?.client === client && view.projectId === projectId && view.editor === editor ? view : null;
  const controller = scope?.controller, state = scope?.state ?? EMPTY;
  const busy = state.phase === 'loading' || state.phase === 'saving';
  useEffect(() => {
    const instance = new SavedDraftController(client, projectId);
    const unsubscribe = instance.subscribe(state => {
      if (state.phase === 'ready' && state.snapshot && editor.state.phase === 'ready' && !editor.state.more && editor.canEdit)
        editor.markServerDraft(state.snapshot.draft);
      setView({ client, projectId, editor, controller: instance, state });
    });
    const unwatch = editor.subscribe(() => {
      if (editor.state.phase !== 'ready' || editor.state.more || !editor.canEdit) instance.suspend();
    });
    return () => { unsubscribe(); unwatch(); instance.destroy(); };
  }, [client, projectId, editor]);
  useEffect(() => { if (!editable) controller?.suspend(); setNotice(null); }, [controller, editable]);
  const stored = editable ? state.snapshot?.draft : null;
  const current = { targetVersion: editor.state.target, draftText: editor.state.draft };
  const matches = state.confirmed && state.confirmed.targetVersion === current.targetVersion && state.confirmed.draftText === current.draftText;
  const useServer = () => {
    if (!controller || !editable || busy || !stored) return;
    if (editor.hasDraftInputChanges && !window.confirm(t('settings:confirmUseServerDraft'))) {
      setNotice('loadCancelled'); return;
    }
    const file = schemaDraftFile(projectId, stored.targetVersion, stored.draftText);
    if (editor.importDraft(file.text, { discardDraft: true, source: 'server' })) { editor.markServerDraft(stored); controller.acceptReview(); setNotice(null); }
  };
  return <section className="schema-server-draft" aria-labelledby="server-draft-heading" aria-busy={busy || undefined}>
    <h3 id="server-draft-heading">{t('settings:serverDraft')}</h3>
    <p className="context-note">{t('settings:serverDraftHelp')}</p>
    <div className="form-actions">
      <button className="secondary-button" type="button" disabled={!editable || !controller || busy} onClick={() => { setNotice(null); void controller?.load(); }}>
        {state.phase === 'loading' ? t('settings:checkingServerDraft') : state.reviewRequired ? t('settings:checkServerSaveResult') : t('settings:checkServerDraft')}
      </button>
      <button className="secondary-button" type="button" disabled={!editable || state.phase !== 'ready' || !state.snapshot || state.reviewRequired}
        onClick={() => { setNotice(null); void controller?.save(current); }}>{state.phase === 'saving' ? t('settings:savingServerDraft') : t('settings:saveCurrentToServer')}</button>
      <button className="secondary-button" type="button" disabled={!editable || busy || !stored} onClick={useServer}>{t('settings:loadServerDraft')}</button>
    </div>
    {state.phase === 'idle' && <p className="field-help">{t('settings:serverDraftFirstHelp')}</p>}
    {editable && state.phase === 'ready' && state.snapshot && <p role="status">{stored ? <>{t('settings:serverSavedAt')} <time dateTime={stored.updatedAt}>{stored.updatedAt}</time></> : t('settings:noServerDraft')}</p>}
    {state.phase === 'saving' && <p role="status">{t('settings:savingSelectedInput')}</p>}
    {editable && state.confirmed && <p role="status">{matches ? t('settings:serverSaveConfirmed') : t('settings:laterEditsNotSaved')}</p>}
    {state.error && <p className="form-error" role="alert">{messageText(state.error)}</p>}
    {state.reviewRequired && <p className="notice">{t('settings:serverDraftReviewRequired')}</p>}
    {editable && state.phase === 'ready' && state.snapshot && <>
      <section><h4>{t('settings:compareServerAndCurrent')}</h4>
        <div className="schema-comparison">
          <div><h4>{t('settings:serverDraft')}</h4><p>{t('settings:versionInput')} {stored?.targetVersion || t('settings:emptyValue')}</p><pre tabIndex={0} aria-label={t('settings:savedServerDraft')}>{stored ? stored.draftText : t('settings:noSavedDraft')}</pre></div>
          <div><h4>{t('settings:currentInput')}</h4><p>{t('settings:versionInput')} {current.targetVersion || t('settings:emptyValue')}</p><pre tabIndex={0} aria-label={t('settings:currentDraftInput')}>{current.draftText}</pre></div>
        </div>
      </section>
      {state.reviewRequired && <button className="secondary-button" type="button" onClick={() => { controller?.acceptReview(); setNotice('keptCurrent'); }}>{t('settings:keepCurrentAndReviewSave')}</button>}
    </>}
    {notice && <p role="status">{notice === 'loadCancelled' ? t('settings:serverDraftLoadCancelled') : t('settings:currentInputKept')}</p>}
    {!editable && <p className="field-help">{t('settings:serverDraftOwnerOnly')}</p>}
  </section>;
}
