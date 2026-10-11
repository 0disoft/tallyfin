// Inline confirmation and status panel for one server publisher permission
// change. The parent PublisherEditor owns the state machine and performs the
// single write; this file only renders that state and forwards the explicit
// actions. The parent owns focus through confirmRef/cancelRef. Publisher
// identities live in component state while a change is pending and are never
// written to storage or logs. Publishing permission stays separate from
// administrator grants: the request carries identity and state only.

import type { RefObject } from 'react';
import type { PublisherEditorState } from './api/publisher-editor.ts';

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
  /** Renders the creation stamp the revocation compares against. */
  formatStamp: (value: string) => string;
  /** Locks the review confirmation while the surrounding settings editor is busy; an unresolved write stays retryable. */
  locked?: boolean;
};

export default function PublisherChangePanel({ state, saving, uncertain, listLoading, confirmRef, cancelRef,
  onConfirm, onCancel, onReload, formatStamp, locked = false }: PublisherChangePanelProps) {
  const { phase, request, message } = state;
  if (phase === 'idle') return null;
  const facts = request ? <dl id="publisher-change-facts" className="grant-change-facts">
    <div><dt>발급자</dt><dd>{request.issuer}</dd></div>
    <div><dt>계정 식별자</dt><dd>{request.subject}</dd></div>
    <div><dt>발행 권한</dt><dd>{request.granted ? '부여' : '회수'}</dd></div>
    {!request.granted && <div><dt>회수 기준 등록 시각</dt><dd>{request.expectedCreatedAt === null
      ? '등록된 권한 없음으로 확인' : formatStamp(request.expectedCreatedAt)}</dd></div>}
  </dl> : null;

  // Review keeps one pending candidate; an unresolved write keeps only the same request.
  if (phase === 'review' || saving || uncertain) {
    return <section className="grant-change-panel" aria-labelledby="publisher-change-heading">
      <h4 id="publisher-change-heading" className="grant-change-heading">{uncertain ? '저장 결과 확인' : '발행 권한 변경 확인'}</h4>
      {facts}
      <p className="context-note">서버 발행 권한은 관리자 조회·소유자 권한과 별개예요. 부여해도 프로젝트 조회 권한은 생기지 않아요.</p>
      {saving && <p className="context-note" role="status">저장 중이에요. 끝날 때까지 다른 변경을 시작할 수 없어요.</p>}
      {uncertain && <p className="grant-change-impact" role="status">{message ?? '저장 결과를 확인하지 못했어요.'}</p>}
      <div className="grant-change-actions">
        <button ref={confirmRef} className="primary-button" type="button" aria-describedby={request ? 'publisher-change-facts' : undefined}
          disabled={saving || (locked && phase === 'review')} onClick={onConfirm}>
          {saving ? '저장 중…' : uncertain ? '같은 요청으로 다시 확인' : request?.granted ? '권한 부여 저장' : '권한 회수 저장'}
        </button>
        {!uncertain && <button ref={cancelRef} className="secondary-button" type="button" disabled={saving} onClick={onCancel}>취소</button>}
      </div>
    </section>;
  }

  // A rejected write keeps the reviewed request only until the list is re-read.
  if (phase === 'error' && request) {
    return <section className="grant-change-panel" aria-labelledby="publisher-change-heading">
      <h4 id="publisher-change-heading" className="grant-change-heading">발행 권한 변경</h4>
      {facts}
      <p className="form-error" role="alert">{message ?? '발행 권한을 저장하지 못했어요.'}</p>
      <p className="context-note">최신 목록을 확인한 뒤에 새 변경을 시작할 수 있어요.</p>
      <div className="grant-change-actions">
        <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>닫기</button>
        <button className="secondary-button" type="button" disabled={listLoading} onClick={onReload}>{listLoading ? '다시 읽는 중…' : '최신 목록 확인'}</button>
      </div>
    </section>;
  }

  // Local input errors can be dismissed; success and denied states only report.
  return <section className="grant-change-panel" aria-labelledby="publisher-change-heading">
    <h4 id="publisher-change-heading" className="grant-change-heading">발행 권한 변경</h4>
    <p className={phase === 'success' ? 'form-success' : 'form-error'} role={phase === 'success' ? 'status' : 'alert'}>
      {message ?? (phase === 'denied' ? '발행 권한을 변경할 수 없어요.' : '발행 권한 요청을 확인해 주세요.')}
    </p>
    {(phase === 'success' || phase === 'error') && <div className="grant-change-actions">
      <button ref={cancelRef} className="secondary-button" type="button" onClick={onCancel}>닫기</button>
    </div>}
  </section>;
}
