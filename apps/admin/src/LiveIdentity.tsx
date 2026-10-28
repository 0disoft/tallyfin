import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import { IDENTITY_IDLE, IdentityReader, identityJson, type AdminIdentity, type IdentityState } from './api/admin-identity';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

export default function LiveIdentity({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const readerRef = useRef<IdentityReader | null>(null);
  const [read, setRead] = useState<{ client: ApiClient; state: IdentityState } | null>(null);
  const [copy, setCopy] = useState<{ client: ApiClient; identity: AdminIdentity; copied: boolean } | null>(null);
  useEffect(() => {
    const reader = new IdentityReader(client, state => setRead({ client, state }));
    readerRef.current = reader; setRead({ client, state: reader.state });
    return () => { reader.destroy(); if (readerRef.current === reader) readerRef.current = null; };
  }, [client]);
  const state = read?.client === client ? read.state : IDENTITY_IDLE;
  const identity = state.identity;
  const text = identity ? identityJson(identity) : '';
  async function copyIdentity() {
    if (!identity) return;
    let copied: boolean;
    try { await navigator.clipboard.writeText(text); copied = true; }
    catch { copied = false; }
    setCopy({ client, identity, copied });
  }
  return <details className="manual-connection" open={state.phase !== 'idle'} onToggle={event => {
    if (event.currentTarget.open && readerRef.current?.state.phase === 'idle') void readerRef.current.open();
    else if (!event.currentTarget.open) readerRef.current?.close();
  }}>
    <summary>{t('operations:identitySummary')}</summary>
    <section className="settings-section" aria-label={t('operations:identitySectionLabel')} aria-busy={state.phase === 'loading'}>
      <p className="context-note">{t('operations:identityIntro')}</p>
      {state.phase === 'loading' && <p role="status">{t('operations:identityLoading')}</p>}
      {state.phase === 'error' && <p className="form-error" role="alert">{messageText(state.message)}</p>}
      {identity && <div className="settings-form">
        <label className="field-label" htmlFor="admin-identity-issuer">{t('operations:identityIssuer')}</label>
        <input className="text-input" id="admin-identity-issuer" value={identity.issuer} readOnly />
        <label className="field-label" htmlFor="admin-identity-subject">{t('operations:identitySubject')}</label>
        <input className="text-input" id="admin-identity-subject" value={identity.subject} readOnly />
        <button className="secondary-button" type="button" onClick={() => void copyIdentity()}>{t('operations:identityCopy')}</button>
        <label className="field-label" htmlFor="admin-identity-json">{t('operations:identityJsonLabel')}</label>
        <textarea className="text-input settings-textarea" id="admin-identity-json" value={text} readOnly rows={5} spellCheck={false} />
        {copy?.client === client && copy.identity === identity && <p className="context-note" role="status">{t(copy.copied ? 'operations:identityCopied' : 'operations:identityCopyFailed')}</p>}
      </div>}
      {state.phase !== 'idle' && <button className="secondary-button" type="button" disabled={state.phase === 'loading'} onClick={() => void readerRef.current?.open()}>{t('operations:identityAgain')}</button>}
    </section>
  </details>;
}
