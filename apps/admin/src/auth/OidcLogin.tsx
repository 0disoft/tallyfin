import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Info, LockKey, SignIn } from '@phosphor-icons/react';
import { BrowserLogin, LoginError } from './client';
import { loginConfig } from './config';
import { initialCallback, clearCallback } from './bootstrap';
import { useI18n } from '../i18n';

export default function OidcLogin({ onConnected, onBeforeLogin, standalone = false }: { onConnected: (login: BrowserLogin) => void; onBeforeLogin?: () => boolean; standalone?: boolean }) {
  const { t } = useI18n();
  const headingId = useId();
  const Heading = standalone ? 'h1' : 'h2';
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

  return <section className={standalone ? 'oidc-login' : 'settings-section oidc-login'} aria-labelledby={headingId}>
    {standalone && <span className="login-emblem"><LockKey size={28} aria-hidden="true" /></span>}
    <Heading id={headingId}>{t('operations:loginHeading')}</Heading>
    {!enabled && <div className="login-setup-note">
      <Info size={20} aria-hidden="true" /><p>{t('operations:loginNotConfigured')}</p>
    </div>}
    <div className="login-actions">
      {enabled && <button className="primary-button" type="button" onClick={start} disabled={busy}><SignIn size={20} aria-hidden="true" />{busy ? t('operations:loginChecking') : t('operations:loginButton')}</button>}
      {(!enabled || standalone) && <a className={enabled ? 'secondary-button login-demo' : 'primary-button login-demo'} href="/demo">{t('operations:loginSampleDemo')}<ArrowRight size={18} aria-hidden="true" /></a>}
    </div>
    {error && <p className="form-error" role="alert">{t(error === 'config' ? 'operations:loginConfigError' : 'operations:loginFailed')}</p>}
    {busy && <p className="context-note" role="status" aria-live="polite">{t('operations:loginBusy')}</p>}
  </section>;
}
