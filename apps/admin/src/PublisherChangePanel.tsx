// Inline confirmation and status panel for one server publisher permission
// change. The parent PublisherEditor owns the state machine and performs the
// single write; this file only renders that state and forwards the explicit
// actions. The parent owns focus through confirmRef/cancelRef. Publisher
// identities live in component state while a change is pending and are never
// written to storage or logs. Publishing permission stays separate from
// administrator grants: the request carries identity and state only.

import type { RefObject } from 'react';
import type { PublisherEditorState } from './api/publisher-editor.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

export type PublisherChangePanelProps = {
  state: PublisherEditorState;
  saving: boolean;
  uncertain: boolean;
  listLoading: boolean;
  confirmRef: RefObject<HTMLButtonElement | null>;
  cancelRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
  onReload: () => void;
  /** Locks the review confirmation while the surrounding settings editor is busy; an unresolved write stays retryable. */
  locked?: boolean;
};

export default function PublisherChangePanel({ state, saving, uncertain, listLoading, confirmRef, cancelRef,
  onConfirm, onCancel, onReload, locked = false }: PublisherChangePanelProps) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const { phase, request, message } = state;
  if (phase === 'idle') return null;
  const facts = request ? <dl id="publisher-change-facts" className="grant-change-facts">
    <div><dt>{t('operations:identityIssuer')}</dt><dd>{request.issuer}</dd></div>
    <div><dt>{t('operations:grantsSubjectLabel')}</dt><dd>{request.subject}</dd></div>
    <div><dt>{t('operations:publisherPermission')}</dt><dd>{request.granted ? t('operations:publisherGranted') : t('operations:publisherRevoked')}</dd></div>
  </dl> : null;
  // The revocation states its scope in plain words. The grant generation the
  // request carries stays internal and is never rendered to the operator.
  const scope = request && !request.granted ? t('operations:publisherRevokeScope') : null;

  // Review keeps one pending candidate; an unresolved write keeps only the same request.
  if (phase === 'review' || saving || uncertain) {
    return <section className="grant-change-panel" aria-labelledby="publisher-change-heading">
      <h4 id="publisher-change-heading" className="grant-change-heading">{t(uncertain ? 'operations:saveResultHeading' : 'operations:publisherReviewHeading')}</h4>
      {facts}
      {scope && <p className="context-note" id="publisher-revoke-scope">{scope}</p>}
      <p className="context-note">{t('operations:publisherSeparateNote')}</p>
      {saving && <p className="context-note" role="status">{t('operations:savingNote')}</p>}
      {uncertain && <p className="grant-change-impact" role="status">{message ? messageText(message) : t('operations:saveResultFailed')}</p>}
      <div className="grant-change-actions">
        <button ref={confirmRef} className="primary-button" type="button"
          aria-describedby={request ? scope ? 'publisher-change-facts publisher-revoke-scope' : 'publisher-change-facts' : undefined}
          disabled={saving || (locked && phase === 'review')} onClick={onConfirm}>
          {saving ? t('operations:savingButton') : uncertain ? t('operations:retrySameRequest') : request?.granted ? t('operations:publisherSaveGrant') : t('operations:publisherSaveRevoke')}
        </button>
        {!uncertain && <button ref={cancelRef} className="secondary-button" type="button" disabled={saving} onClick={onCancel}>{t('operations:cancelButton')}</button>}
      </div>
    </section>;
  }

  // A rejected write keeps the reviewed request only until the list is re-read.
  if (phase === 'error' && request) {
    return <section className="grant-change-panel" aria-labelledby="publisher-change-heading">
      <h4 id="publisher-change-heading" className="grant-change-heading">{t('operations:publisherChangeHeading')}</h4>
      {facts}
      {scope && <p className="context-note">{scope}</p>}
      <p className="form-error" role="alert">{message ? messageText(message) : t('operations:publisherSaveFailed')}</p>
      <p className="context-note">{t('operations:staleListNote')}</p>
      <div className="grant-change-actions">
        <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>{t('operations:closeButton')}</button>
        <button className="secondary-button" type="button" disabled={listLoading} onClick={onReload}>{listLoading ? t('operations:reloadingList') : t('operations:reloadList')}</button>
      </div>
    </section>;
  }

  // Local input errors can be dismissed; success and denied states only report.
  return <section className="grant-change-panel" aria-labelledby="publisher-change-heading">
    <h4 id="publisher-change-heading" className="grant-change-heading">{t('operations:publisherChangeHeading')}</h4>
    <p className={phase === 'success' ? 'form-success' : 'form-error'} role={phase === 'success' ? 'status' : 'alert'}>
      {message ? messageText(message) : phase === 'denied' ? t('operations:publisherDenied') : t('operations:publisherCheckRequest')}
    </p>
    {(phase === 'success' || phase === 'error') && <div className="grant-change-actions">
      <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>{t('operations:closeButton')}</button>
    </div>}
  </section>;
}
