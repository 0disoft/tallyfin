import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { SchemaEditor } from './api/schema-editor.ts';
import type { SchemaState } from './api/schema-editor.ts';
import { readDraft } from './api/schema-contract.ts';
import type { SchemaIssueCode } from './api/schema-contract.ts';
import SchemaEventForm from './SchemaEventForm.tsx';
import { eventIssueTarget } from './api/schema-event-form.ts';
import { propertyIssueTarget } from './api/schema-property-form.ts';
import SchemaWorkflowForm from './SchemaWorkflowForm.tsx';
import { workflowIssueTarget } from './api/schema-workflow-form.ts';
import SchemaFunnelForm from './SchemaFunnelForm.tsx';
import { funnelIssueTarget } from './api/schema-funnel-form.ts';

const ISSUE_TEXT: Record<SchemaIssueCode, string> = {
  invalid_definition: '필수 항목·자료형·이름·허용 값을 확인해 주세요.', definition_limit: '이벤트 1~50개, 작업 흐름·퍼널 각각 최대 10개, 퍼널 단계 2~10개, 정의 32KiB 한도를 확인해 주세요.',
  duplicate: '이벤트 이름·흐름 ID·퍼널 ID 또는 퍼널 단계 이벤트가 중복돼요.', cardinality_limit: '속성 종류 수는 최대 32개, 이벤트별 가능한 조합은 최대 256개예요.',
  browser_event_required: '등록된 이벤트 출처를 확인해 주세요.', invalid_reference: '단계 이벤트와 출처가 등록되어 있는지, 작업 흐름의 단계 이벤트가 다른 흐름과 겹치지 않는지 확인해 주세요.',
  dimension_mismatch: '비교 기준은 모든 단계에 같은 자료형과 허용 값을 가진 필수 속성으로 있어야 해요.',
};

export default function LiveSchemas({ client, projectId, refreshTick, onVersionChange }: { client: ApiClient; projectId: string; refreshTick: number; onVersionChange?: (version: number) => void }) {
  const [state, setState] = useState<SchemaState | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const editorRef = useRef<SchemaEditor | null>(null), inputRef = useRef<HTMLTextAreaElement>(null), tick = useRef(refreshTick);
  const previousVersion = useRef<number | null | undefined>(undefined);
  const version = state?.phase === 'ready' ? state.snapshot?.page.latestVersion : undefined;
  useEffect(() => {
    if (version === undefined) return;
    if (previousVersion.current !== undefined && version !== null && version !== previousVersion.current) onVersionChange?.(version);
    previousVersion.current = version;
  }, [version, onVersionChange]);
  useEffect(() => {
    const editor = new SchemaEditor(client, projectId); editorRef.current = editor;
    const unsubscribe = editor.subscribe(setState); void editor.load();
    return () => { unsubscribe(); editor.destroy(); if (editorRef.current === editor) editorRef.current = null; };
  }, [client, projectId]);
  useEffect(() => { if (tick.current !== refreshTick) { tick.current = refreshTick; void editorRef.current?.refresh(); } }, [refreshTick]);
  const issue = state?.report?.issues[0];
  useEffect(() => {
    if (!state?.formError && !issue) return;
    const target = issue && state ? funnelIssueTarget(state.draft, issue) ?? workflowIssueTarget(state.draft, issue) ?? propertyIssueTarget(state.draft, issue) ?? eventIssueTarget(state.draft, issue) : null;
    if (target) { const frame = requestAnimationFrame(() => document.getElementById(target)?.focus()); return () => cancelAnimationFrame(frame); }
    setJsonOpen(true);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [state?.formError, issue]);
  if (!state || !state.snapshot) return <section className="settings-section schema-section" aria-busy={!state || state.phase === 'loading'}>
    <h2>이벤트 스키마</h2>
    <p role={state?.phase === 'error' ? 'alert' : 'status'}>{state?.phase === 'error' ? state.message : '스키마 목록과 권한을 불러오는 중이에요.'}</p>
    {state?.phase === 'error' && <button className="secondary-button" onClick={() => { void editorRef.current?.load(); }}>다시 불러오기</button>}
  </section>;
  const { snapshot } = state, busy = ['loading', 'validating', 'publishing'].includes(state.phase), owner = !state.blocked && (state.latest?.settings.canEdit ?? snapshot.settings.canEdit);
  const unlocked = state.phase === 'ready' && !state.more, editable = unlocked && owner;
  const publishable = editable && state.validatedKey === `${state.target}\n${state.draft}` && state.privacyReviewed;
  let preview: { events: unknown[]; workflows: unknown[]; funnels?: unknown[] } | null = null;
  try { preview = readDraft(state.draft); } catch { /* Invalid JSON remains in the editor until explicitly validated. */ }
  return <section className="settings-section schema-section" aria-labelledby="schema-heading" aria-busy={busy || undefined}>
    <div className="settings-head"><h2 id="schema-heading">이벤트 스키마</h2>
      <span className="settings-badge">{state.blocked ? '권한 확인 필요' : owner ? '소유자' : '읽기 전용'}</span></div>
    <p className="context-note">이벤트·속성·작업 흐름·퍼널 정의를 새 버전으로 발행해요. 기존 버전과 집계는 그대로 유지돼요.</p>
    {state.blocked ? <p className="notice">초안은 보존했지만 편집·검증·발행은 잠겼어요. 서버 상태를 확인하고 사용할 내용을 다시 골라 주세요.</p>
      : !owner && <p className="notice">등록된 정의를 읽을 수 있어요. 편집·검증·발행에는 소유자 권한이 필요해요.</p>}
    <div className="schema-toolbar"><p>조회한 최신 버전: <strong>{snapshot.page.latestVersion === null ? '아직 없음' : `v${snapshot.page.latestVersion}`}</strong></p>
      <button className="secondary-button" disabled={busy || state.more} onClick={() => { void editorRef.current?.refresh(); }}>목록 새로고침</button></div>
    <div className="table-scroll" tabIndex={0} aria-label="스키마 버전 목록"><table className="event-table">
      <caption className="sr-only">발행된 스키마 버전과 상태</caption>
      <thead><tr><th scope="col">버전</th><th scope="col">상태</th><th scope="col">발행일</th><th scope="col">정의</th></tr></thead>
      <tbody>{snapshot.page.data.length ? snapshot.page.data.map(row => <tr key={row.schemaVersion}>
        <th scope="row">v{row.schemaVersion}</th><td>{row.schemaStatus === 'active' ? '사용 중' : '사용 중지'}</td>
        <td><time dateTime={row.publishedAt}>{new Date(row.publishedAt).toLocaleDateString('ko-KR', { timeZone: snapshot.settings.project.timeZone })}</time></td>
        <td><button className="secondary-button" disabled={!unlocked} onClick={() => { void editorRef.current?.selectVersion(row.schemaVersion); }}>v{row.schemaVersion} 불러오기</button></td>
      </tr>) : <tr><td colSpan={4}>발행된 스키마가 없어요. 첫 정의를 작성해 주세요.</td></tr>}</tbody>
    </table></div>
    {snapshot.page.page.beforeVersion !== null && <button className="secondary-button" disabled={!unlocked} onClick={() => { void editorRef.current?.loadMore(); }}>{state.more ? '불러오는 중…' : '이전 버전 더 보기'}</button>}
    <p className="field-help">버전을 불러오면 편집기의 내용을 바꿔요. 초안은 메모리에만 두며 페이지나 프로젝트를 떠나면 사라져요.</p>
    {state.message && <p className="settings-message" role="status">{state.message}</p>}
    {state.phase === 'review' && <section className="settings-recovery" aria-label="스키마 충돌과 발행 결과 확인">
      <h3>발행 결과 확인</h3>
      <button className="secondary-button" onClick={() => { void editorRef.current?.checkLatest(); }}>서버 상태 확인</button>
      {state.latest && <>
        <p>서버 최신 버전: {state.latest.page.latestVersion === null ? '없음' : `v${state.latest.page.latestVersion}`}</p>
        <div className="schema-comparison">
          <div><h4>최신 서버 정의</h4><pre tabIndex={0} aria-label="최신 서버 정의">{JSON.stringify(state.latest.definitions, null, 2)}</pre></div>
          <div><h4>내 초안</h4><pre tabIndex={0} aria-label="보존한 초안">{state.draft}</pre></div>
        </div>
        <div className="form-actions"><button className="primary-button" onClick={() => editorRef.current?.useServer()}>서버 정의 사용</button>
          <button className="secondary-button" disabled={!state.latest.settings.canEdit} onClick={() => editorRef.current?.keepDraft()}>초안 유지하고 다시 검토</button></div>
      </>}
    </section>}
    <form className="schema-form" onSubmit={event => { event.preventDefault(); void editorRef.current?.publish(); }} noValidate>
      <div className="settings-field schema-version-field"><label className="field-label" htmlFor="schema-version">발행할 새 버전</label>
        <input className="text-input" id="schema-version" inputMode="numeric" value={state.target} disabled={!editable} onChange={e => editorRef.current?.edit('target', e.target.value)} aria-describedby="schema-version-help" />
        <p className="field-help" id="schema-version-help">최신 버전보다 큰 정수. 최대 2,147,483,647.</p></div>
      <SchemaEventForm draft={state.draft} editable={editable} issue={issue} onChange={next => editorRef.current?.edit('draft', next)}
        onOpenJson={() => { setJsonOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }} />
      <SchemaWorkflowForm draft={state.draft} editable={editable} issue={issue} onChange={next => editorRef.current?.edit('draft', next)}
        onOpenJson={() => { setJsonOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }} />
      <SchemaFunnelForm draft={state.draft} editable={editable} issue={issue} onChange={next => editorRef.current?.edit('draft', next)}
        onOpenJson={() => { setJsonOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }} />
      <details className="schema-json-editor" open={jsonOpen} onToggle={event => setJsonOpen(event.currentTarget.open)}>
        <summary>JSON 직접 편집</summary>
      <div className="settings-field"><label className="field-label" htmlFor="schema-draft">스키마 정의 (JSON)</label>
        <textarea id="schema-draft" ref={inputRef} className="text-input schema-textarea" rows={18} spellCheck={false} value={state.draft} readOnly={!editable}
          onChange={e => editorRef.current?.edit('draft', e.target.value)} aria-invalid={Boolean(state.formError || issue) || undefined} aria-describedby="schema-draft-help schema-errors" />
        <p className="field-help" id="schema-draft-help">events·workflows 배열과 선택 funnels 배열을 입력해요. 이벤트는 1~50개, 흐름·퍼널은 각각 최대 10개, 퍼널 단계는 2~10개예요. 이름은 영문 소문자·숫자·밑줄로 써요.</p>
      </div></details>
        <div id="schema-errors">{state.formError && <p className="form-error" role="alert">{state.formError}</p>}
          {issue && <p className="form-error" role="alert"><code>{issue.path || '전체 정의'}</code> — {ISSUE_TEXT[issue.code]}</p>}</div>
      <details className="schema-preview"><summary>초안 미리보기{preview ? ` · 이벤트 ${preview.events.length}개 · 흐름 ${preview.workflows.length}개 · 퍼널 ${preview.funnels?.length ?? 0}개` : ''}</summary>
        {preview ? <div className="table-scroll" tabIndex={0} aria-label="초안 이벤트 목록"><table className="event-table"><caption className="sr-only">검증 전 초안의 이벤트 목록</caption>
          <thead><tr><th scope="col">이벤트</th><th scope="col">표시 이름</th><th scope="col">출처</th></tr></thead>
          <tbody>{preview.events.slice(0, 50).map((item, index) => { const r = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const text = (key: string) => typeof r[key] === 'string' ? String(r[key]) : '—';
            return <tr key={index}><th scope="row">{text('name')}</th><td>{text('label')}</td><td>{text('source')}</td></tr>; })}</tbody></table></div>
          : <p>JSON 형식을 확인하면 미리보기가 표시돼요.</p>}
      </details>
      <label className="schema-privacy"><input type="checkbox" checked={state.privacyReviewed} disabled={!editable || !state.report?.valid} onChange={e => editorRef.current?.setPrivacy(e.target.checked)} />
        <span>정의와 허용 값에 개인정보·원시 입력값이 없음을 검토했어요.</span></label>
      <p className="field-help">자동 검증은 형식과 참조를 확인해요. 개인정보 검토는 관리자가 직접 해야 해요.</p>
      <div className="form-actions"><button className="secondary-button" type="button" disabled={!editable} onClick={() => { void editorRef.current?.validate(); }}>{state.phase === 'validating' ? '검증 중…' : '정의 검증'}</button>
        <button className="primary-button" type="submit" disabled={!publishable}>{state.phase === 'publishing' ? '발행 중…' : `새 버전 발행${state.target ? ` (v${state.target})` : ''}`}</button></div>
      <p className="field-help">발행 후 제품 SDK에서 사용할 버전을 별도로 전환해 주세요.</p>
    </form>
  </section>;
}
