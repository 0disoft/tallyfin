// Inline confirmation and status panel for one project-grant change.
// The parent GrantEditor owns the state machine and performs the single write;
// this file only renders that state and forwards the explicit actions. The
// parent owns focus through confirmRef/cancelRef. Identities live in component
// state while a change is pending and are never written to storage or logs.

import type { RefObject } from 'react';
import type { GrantEditorState } from './api/grant-editor.ts';
import type { GrantChange, GrantRole } from './api/grants-contract.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

export type GrantChangePanelProps = {
  state: GrantEditorState;
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

function lowersAccess(change: GrantChange): boolean {
  // The console never learns which identity the session is signed in as, so a
  // revoke or an owner downgrade always warns that it may remove its own access.
  return change.role === null || (change.expectedRole === 'owner' && change.role === 'reader');
}

export default function GrantChangePanel({ state, saving, uncertain, listLoading, confirmRef, cancelRef, onConfirm, onCancel, onReload, locked = false }: GrantChangePanelProps) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const { phase, change, message } = state;
  /** Role stored after the change; null means the grant is removed. */
  const roleLabel = (role: GrantRole | null): string => role === null ? t('operations:roleRevoked') : role === 'owner' ? t('operations:roleOwner') : t('operations:roleReader');
  /** Role the caller last observed; null means no grant was registered. */
  const currentLabel = (role: GrantRole | null): string => role === null ? t('operations:roleNoGrant') : role === 'owner' ? t('operations:roleOwner') : t('operations:roleReader');
  if (phase === 'idle') return null;
  const identity = change ? <dl id="grant-change-facts" className="grant-change-facts">
    <div><dt>{t('operations:identityIssuer')}</dt><dd>{change.issuer}</dd></div>
    <div><dt>{t('operations:grantsSubjectLabel')}</dt><dd>{change.subject}</dd></div>
    <div><dt>{t('operations:roleLabel')}</dt><dd>{currentLabel(change.expectedRole)} → {roleLabel(change.role)}</dd></div>
  </dl> : null;

  // Review keeps one pending candidate; an unresolved write keeps only the same request.
  if (phase === 'review' || saving || uncertain) {
    return <section className="grant-change-panel" aria-labelledby="grant-change-heading">
      <h4 id="grant-change-heading" className="grant-change-heading">{t(uncertain ? 'operations:saveResultHeading' : 'operations:grantReviewHeading')}</h4>
      {identity}
      {change && lowersAccess(change) && <p id="grant-change-impact" className="grant-change-impact">{t('operations:grantImpact')}</p>}
      {saving && <p className="context-note" role="status">{t('operations:savingNote')}</p>}
      {uncertain && <p className="grant-change-impact" role="status">{message ? messageText(message) : t('operations:saveResultFailed')}</p>}
      <div className="grant-change-actions">
        <button ref={confirmRef} className="primary-button" type="button" aria-describedby={change ? `grant-change-facts${lowersAccess(change) ? ' grant-change-impact' : ''}` : undefined} disabled={saving || (locked && phase === 'review')} onClick={onConfirm}>
          {saving ? t('operations:savingButton') : uncertain ? t('operations:retrySameRequest') : change?.role === null ? t('operations:grantSaveRevoke') : t('operations:grantSaveRole')}
        </button>
        {!uncertain && <button ref={cancelRef} className="secondary-button" type="button" disabled={saving} onClick={onCancel}>{t('operations:cancelButton')}</button>}
      </div>
    </section>;
  }

  // A rejected write keeps the reviewed change only until the page is re-read.
  if (phase === 'error' && change) {
    return <section className="grant-change-panel" aria-labelledby="grant-change-heading">
      <h4 id="grant-change-heading" className="grant-change-heading">{t('operations:grantChangeHeading')}</h4>
      {identity}
      <p className="form-error" role="alert">{message ? messageText(message) : t('operations:grantSaveFailed')}</p>
      <p className="context-note">{t('operations:staleListNote')}</p>
      <div className="grant-change-actions">
        <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>{t('operations:closeButton')}</button>
        <button className="secondary-button" type="button" disabled={listLoading} onClick={onReload}>{listLoading ? t('operations:reloadingList') : t('operations:reloadList')}</button>
      </div>
    </section>;
  }

  // Local input errors can be dismissed; success and denied states only report.
  return <section className="grant-change-panel" aria-labelledby="grant-change-heading">
    <h4 id="grant-change-heading" className="grant-change-heading">{t('operations:grantChangeHeading')}</h4>
    <p className={phase === 'success' ? 'form-success' : 'form-error'} role={phase === 'success' ? 'status' : 'alert'}>
      {message ? messageText(message) : phase === 'denied' ? t('operations:grantDenied') : t('operations:grantCheckRequest')}
    </p>
    {(phase === 'success' || phase === 'error') && <div className="grant-change-actions">
      <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>{t('operations:closeButton')}</button>
    </div>}
  </section>;
}
