import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import type { SchemaEditor } from './api/schema-editor.ts';
import { SavedDraftController, type SavedDraftState } from './api/saved-draft-controller.ts';
import { schemaDraftFile } from './api/schema-draft-file.ts';

const EMPTY: SavedDraftState = { phase: 'idle', snapshot: null, pending: null, confirmed: null, reviewRequired: false, error: null };

export default function ServerSchemaDraft({ client, projectId, editor, editable }: {
  client: ApiClient; projectId: string; editor: SchemaEditor; editable: boolean;
}) {
  const [view, setView] = useState<{ client: ApiClient; projectId: string; editor: SchemaEditor; controller: SavedDraftController; state: SavedDraftState } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    if (editor.hasDraftInputChanges && !window.confirm('현재 입력을 서버 초안으로 바꿀까요? 현재 초안과 발행할 버전 입력은 사라져요.')) {
      setNotice('서버 초안 불러오기를 취소했어요. 현재 입력과 검토 상태는 그대로예요.'); return;
    }
    const file = schemaDraftFile(projectId, stored.targetVersion, stored.draftText);
    if (editor.importDraft(file.text, { discardDraft: true, source: 'server' })) { editor.markServerDraft(stored); controller.acceptReview(); setNotice(null); }
  };
  return <section className="schema-server-draft" aria-labelledby="server-draft-heading" aria-busy={busy || undefined}>
    <h3 id="server-draft-heading">서버 초안</h3>
    <p className="context-note">프로젝트 소유자끼리 공유하는 초안이에요. 개인정보·비밀값 없이 정의만 저장해 주세요. 저장해도 발행하거나 버전을 예약하지 않아요.</p>
    <div className="form-actions">
      <button className="secondary-button" type="button" disabled={!editable || !controller || busy} onClick={() => { setNotice(null); void controller?.load(); }}>
        {state.phase === 'loading' ? '서버 초안 확인 중…' : state.reviewRequired ? '서버 저장 결과 확인' : '서버 초안 확인'}
      </button>
      <button className="secondary-button" type="button" disabled={!editable || state.phase !== 'ready' || !state.snapshot || state.reviewRequired}
        onClick={() => { setNotice(null); void controller?.save(current); }}>{state.phase === 'saving' ? '서버 초안 저장 중…' : '현재 입력을 서버에 저장'}</button>
      <button className="secondary-button" type="button" disabled={!editable || busy || !stored} onClick={useServer}>서버 초안 불러오기</button>
    </div>
    {state.phase === 'idle' && <p className="field-help">서버 초안을 먼저 확인한 뒤 현재 입력을 저장할 수 있어요. 자동으로 저장하거나 불러오지 않아요.</p>}
    {editable && state.phase === 'ready' && state.snapshot && <p role="status">{stored ? <>서버 저장 시각: <time dateTime={stored.updatedAt}>{stored.updatedAt}</time></> : '저장된 서버 초안이 없어요.'}</p>}
    {state.phase === 'saving' && <p role="status">선택한 입력을 저장하고 있어요. 이후 편집한 내용은 따로 저장해야 해요.</p>}
    {editable && state.confirmed && <p role="status">{matches ? '현재 입력의 서버 저장을 확인했어요.' : '저장 요청한 입력은 서버에 있어요. 이후 편집한 내용은 아직 저장하지 않았어요.'}</p>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.reviewRequired && <p className="notice">저장 결과나 다른 곳의 변경을 확인해야 해요. 서버 초안을 다시 확인한 뒤 사용할 내용을 골라 주세요. 저장은 자동 재시도하지 않아요.</p>}
    {editable && state.phase === 'ready' && state.snapshot && <>
      <details><summary>서버 초안과 현재 입력 보기</summary>
        <div className="schema-comparison">
          <div><h4>서버 초안</h4><p>버전 입력: {stored?.targetVersion || '빈 값'}</p><pre tabIndex={0} aria-label="저장된 서버 초안">{stored ? stored.draftText : '저장된 초안 없음'}</pre></div>
          <div><h4>현재 입력</h4><p>버전 입력: {current.targetVersion || '빈 값'}</p><pre tabIndex={0} aria-label="현재 초안 입력">{current.draftText}</pre></div>
        </div>
      </details>
      {state.reviewRequired && <button className="secondary-button" type="button" onClick={() => { controller?.acceptReview(); setNotice('현재 입력을 유지했어요. 다음 저장은 확인한 서버 초안을 기준으로 진행해요.'); }}>현재 입력 유지하고 다시 저장 검토</button>}
    </>}
    {notice && <p role="status">{notice}</p>}
    {!editable && <p className="field-help">소유자가 편집 가능한 상태에서만 서버 초안을 확인·저장·불러올 수 있어요.</p>}
  </section>;
}
