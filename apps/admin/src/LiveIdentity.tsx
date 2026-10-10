import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import { IDENTITY_IDLE, IdentityReader, identityJson, type AdminIdentity, type IdentityState } from './api/admin-identity';

export default function LiveIdentity({ client }: { client: ApiClient }) {
  const readerRef = useRef<IdentityReader | null>(null);
  const [read, setRead] = useState<{ client: ApiClient; state: IdentityState } | null>(null);
  const [copy, setCopy] = useState<{ client: ApiClient; identity: AdminIdentity; message: string } | null>(null);
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
    let message: string;
    try { await navigator.clipboard.writeText(text); message = '계정 정보를 복사했어요.'; }
    catch { message = '복사하지 못했어요. 아래 JSON을 직접 선택해 복사해 주세요.'; }
    setCopy({ client, identity, message });
  }
  return <details className="manual-connection" open={state.phase !== 'idle'} onToggle={event => {
    if (event.currentTarget.open && readerRef.current?.state.phase === 'idle') void readerRef.current.open();
    else if (!event.currentTarget.open) readerRef.current?.close();
  }}>
    <summary>로그인 계정 확인</summary>
    <section className="settings-section" aria-label="로그인 계정" aria-busy={state.phase === 'loading'}>
      <p className="context-note">서버가 확인한 관리자 계정이에요. 최초 권한 등록에 사용할 발급자와 계정 식별자를 확인할 수 있어요. 프로젝트 생성 권한은 운영자가 별도로 부여해요.</p>
      {state.phase === 'loading' && <p role="status">계정을 확인하는 중이에요.</p>}
      {state.phase === 'error' && <p className="form-error" role="alert">{state.message}</p>}
      {identity && <div className="settings-form">
        <label className="field-label" htmlFor="admin-identity-issuer">발급자</label>
        <input className="text-input" id="admin-identity-issuer" value={identity.issuer} readOnly />
        <label className="field-label" htmlFor="admin-identity-subject">계정 식별자</label>
        <input className="text-input" id="admin-identity-subject" value={identity.subject} readOnly />
        <button className="secondary-button" type="button" onClick={() => void copyIdentity()}>계정 정보 복사</button>
        <label className="field-label" htmlFor="admin-identity-json">계정 정보 JSON</label>
        <textarea className="text-input settings-textarea" id="admin-identity-json" value={text} readOnly rows={5} spellCheck={false} />
        {copy?.client === client && copy.identity === identity && <p className="context-note" role="status">{copy.message}</p>}
      </div>}
      {state.phase !== 'idle' && <button className="secondary-button" type="button" disabled={state.phase === 'loading'} onClick={() => void readerRef.current?.open()}>다시 확인</button>}
    </section>
  </details>;
}
