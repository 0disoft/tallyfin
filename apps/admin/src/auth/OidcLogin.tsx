import { useEffect, useRef, useState } from 'react';
import { BrowserLogin, LoginError } from './client';
import { loginConfig } from './config';
import { initialCallback, clearCallback } from './bootstrap';

export default function OidcLogin({ onConnected }: { onConnected: (login: BrowserLogin) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          .catch(() => { if (active) setError(new LoginError().message); })
          .finally(() => { clearCallback(); if (active) setBusy(false); });
      }
    } catch {
      clearCallback();
      setBusy(false);
      setError('로그인 제공자 설정이 없거나 올바르지 않아요. 운영자 설정을 확인해 주세요.');
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
    setBusy(true); setError(null);
    try {
      const login = loginRef.current;
      if (!login) throw new LoginError();
      const url = await login.begin();
      if (mountedRef.current) window.location.assign(url);
    } catch { if (mountedRef.current) { setError(new LoginError().message); setBusy(false); } }
  }

  return <section className="settings-section" aria-labelledby="oidc-login-heading">
    <h2 id="oidc-login-heading">관리자 로그인</h2>
    <p className="context-note">로그인 후 권한이 있는 프로젝트를 조회해요. 로그인 정보는 이 탭에서만 유지돼요.</p>
    {!enabled && <>
      <p className="context-note">로그인 제공자가 아직 설정되지 않았어요. 운영자 설정 후 사용할 수 있어요. 설정 전에는 샘플 데이터로 분석 화면을 체험할 수 있어요.</p>
      <p><a className="secondary-button" href="/demo">샘플 데모 둘러보기</a></p>
    </>}
    <button className="primary-button" type="button" onClick={start} disabled={!enabled || busy}>{busy ? '로그인 확인 중…' : '관리자 로그인'}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {busy && <p className="context-note" role="status" aria-live="polite">로그인을 처리하고 있어요.</p>}
  </section>;
}
