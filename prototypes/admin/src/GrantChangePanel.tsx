// Inline confirmation and status panel for one project-grant change.
// The parent GrantEditor owns the state machine and performs the single write;
// this file only renders that state and forwards the explicit actions. The
// parent owns focus through confirmRef/cancelRef. Identities live in component
// state while a change is pending and are never written to storage or logs.

import type { RefObject } from 'react';
import type { GrantEditorState } from './api/grant-editor.ts';
import type { GrantChange, GrantRole } from './api/grants-contract.ts';

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

const ROLE_LABEL: Record<GrantRole, string> = { reader: '조회', owner: '소유자' };

/** Role stored after the change; null means the grant is removed. */
function roleLabel(role: GrantRole | null): string {
  return role === null ? '회수' : ROLE_LABEL[role];
}

/** Role the caller last observed; null means no grant was registered. */
function currentLabel(role: GrantRole | null): string {
  return role === null ? '권한 없음' : ROLE_LABEL[role];
}

function lowersAccess(change: GrantChange): boolean {
  // The console never learns which identity the session is signed in as, so a
  // revoke or an owner downgrade always warns that it may remove its own access.
  return change.role === null || (change.expectedRole === 'owner' && change.role === 'reader');
}

export default function GrantChangePanel({ state, saving, uncertain, listLoading, confirmRef, cancelRef, onConfirm, onCancel, onReload, locked = false }: GrantChangePanelProps) {
  const { phase, change, message } = state;
  if (phase === 'idle') return null;
  const identity = change ? <dl id="grant-change-facts" className="grant-change-facts">
    <div><dt>발급자</dt><dd>{change.issuer}</dd></div>
    <div><dt>계정 식별자</dt><dd>{change.subject}</dd></div>
    <div><dt>역할</dt><dd>{currentLabel(change.expectedRole)} → {roleLabel(change.role)}</dd></div>
  </dl> : null;

  // Review keeps one pending candidate; an unresolved write keeps only the same request.
  if (phase === 'review' || saving || uncertain) {
    return <section className="grant-change-panel" aria-labelledby="grant-change-heading">
      <h4 id="grant-change-heading" className="grant-change-heading">{uncertain ? '저장 결과 확인' : '권한 변경 확인'}</h4>
      {identity}
      {change && lowersAccess(change) && <p id="grant-change-impact" className="grant-change-impact">지금 연결한 계정이 이 대상이면 자기 권한을 스스로 낮추거나 회수하는 셈이에요. 저장하면 이 화면에서 다시 변경할 수 없어요.</p>}
      {saving && <p className="context-note" role="status">저장 중이에요. 끝날 때까지 다른 변경을 시작할 수 없어요.</p>}
      {uncertain && <p className="grant-change-impact" role="status">{message ?? '저장 결과를 확인하지 못했어요.'}</p>}
      <div className="grant-change-actions">
        <button ref={confirmRef} className="primary-button" type="button" aria-describedby={change ? `grant-change-facts${lowersAccess(change) ? ' grant-change-impact' : ''}` : undefined} disabled={saving || (locked && phase === 'review')} onClick={onConfirm}>
          {saving ? '저장 중…' : uncertain ? '같은 요청으로 다시 확인' : change?.role === null ? '회수 저장' : '역할 변경 저장'}
        </button>
        {!uncertain && <button ref={cancelRef} className="secondary-button" type="button" disabled={saving} onClick={onCancel}>취소</button>}
      </div>
    </section>;
  }

  // A rejected write keeps the reviewed change only until the page is re-read.
  if (phase === 'error' && change) {
    return <section className="grant-change-panel" aria-labelledby="grant-change-heading">
      <h4 id="grant-change-heading" className="grant-change-heading">권한 변경</h4>
      {identity}
      <p className="form-error" role="alert">{message ?? '권한을 저장하지 못했어요.'}</p>
      <p className="context-note">최신 목록을 확인한 뒤에 새 변경을 시작할 수 있어요.</p>
      <div className="grant-change-actions">
        <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>닫기</button>
        <button className="secondary-button" type="button" disabled={listLoading} onClick={onReload}>{listLoading ? '다시 읽는 중…' : '최신 목록 확인'}</button>
      </div>
    </section>;
  }

  // Local input errors can be dismissed; success and denied states only report.
  return <section className="grant-change-panel" aria-labelledby="grant-change-heading">
    <h4 id="grant-change-heading" className="grant-change-heading">권한 변경</h4>
    <p className={phase === 'success' ? 'form-success' : 'form-error'} role={phase === 'success' ? 'status' : 'alert'}>
      {message ?? (phase === 'denied' ? '권한을 변경할 수 없어요.' : '권한 요청을 확인해 주세요.')}
    </p>
    {(phase === 'success' || phase === 'error') && <div className="grant-change-actions">
      <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>닫기</button>
    </div>}
  </section>;
}
