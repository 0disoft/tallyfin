import { useEffect, useRef, useState } from 'react';
import { BrowserLogin, LoginError } from './client';
import { loginConfig } from './config';
import { initialCallback, clearCallback } from './bootstrap';
import { useI18n } from '../i18n';

export default function OidcLogin({ onConnected, onBeforeLogin }: { onConnected: (login: BrowserLogin) => void; onBeforeLogin?: () => boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'failed' | 'config' | null>(null);
  const [enabled, setEnabled] = useState(false);
  const loginRef = useRef<BrowserLogin | null>(null);
  const mountedRef = useRef(false);
  const transferredRef = useRef(false);
  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    try {
      const config = loginConfig(import.meta.env, window.location.origin);
      const login = loginRef.current ?? (config ? new BrowserLogin(config, window.sessionStorage) : null);
      loginRef.current = login;
      setEnabled(login !== null);
      const callback = initialCallback();
      if (callback) {
        setBusy(true);
        if (!login) { clearCallback(); throw new LoginError(); }
        login.complete(callback).then(() => {
          if (active) { transferredRef.current = true; onConnected(login); }
        })
          .catch(() => { if (active) setError('failed'); })
          .finally(() => { clearCallback(); if (active) setBusy(false); });
      }
    } catch {
      clearCallback();
      setBusy(false);
      setError('config');
    }
    return () => {
      active = false;
      mountedRef.current = false;
      // StrictMode immediately sets up the same effect again. Real unmounts
      // dispose pending login work unless the API client has taken ownership.
      queueMicrotask(() => {
        if (!mountedRef.current && !transferredRef.current) {
          loginRef.current?.destroy();
          loginRef.current = null;
          clearCallback();
        }
      });
    };
  }, [onConnected]);

  async function start() {
    if (onBeforeLogin && !onBeforeLogin()) return;
    setBusy(true); setError(null);
    try {
      const login = loginRef.current;
      if (!login) throw new LoginError();
      const url = await login.begin();
      if (mountedRef.current) window.location.assign(url);
    } catch { if (mountedRef.current) { setError('failed'); setBusy(false); } }
  }

  return <section className="settings-section" aria-labelledby="oidc-login-heading">
    <h2 id="oidc-login-heading">{t('operations:loginHeading')}</h2>
    <p className="context-note">{t('operations:loginIntro')}</p>
    {!enabled && <>
      <p className="context-note">{t('operations:loginNotConfigured')}</p>
      <p><a className="secondary-button" href="/demo">{t('operations:loginSampleDemo')}</a></p>
    </>}
    <button className="primary-button" type="button" onClick={start} disabled={!enabled || busy}>{busy ? t('operations:loginChecking') : t('operations:loginButton')}</button>
    {error && <p className="form-error" role="alert">{t(error === 'config' ? 'operations:loginConfigError' : 'operations:loginFailed')}</p>}
    {busy && <p className="context-note" role="status" aria-live="polite">{t('operations:loginBusy')}</p>}
  </section>;
}
