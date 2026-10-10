import { useEffect, useRef, useState } from 'react';
import { changeEventForm, eventIsLinked, eventIssueTarget, readEventForm } from './api/schema-event-form.ts';
import type { EventChange, EventFormDraft } from './api/schema-event-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';
import SchemaPropertyForm from './SchemaPropertyForm.tsx';

export default function SchemaEventForm({ draft, editable, onChange, onOpenJson, issue }: {
  draft: string; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setError('');
    if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [draft]);
  let form: EventFormDraft;
  try { form = readEventForm(draft); } catch {
    return <section className="schema-event-form" aria-labelledby="schema-event-heading">
      <h3 id="schema-event-heading">이벤트 편집</h3><p className="notice">JSON 형식이나 이벤트 항목을 확인해야 폼으로 편집할 수 있어요. 입력한 초안은 그대로 보관하고 있어요.</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>JSON 직접 편집 열기</button>
    </section>;
  }
  const errorTarget = issue ? eventIssueTarget(draft, issue) : null;
  function change(action: EventChange) {
    if (!editable) return;
    try {
      const next = changeEventForm(draft, action);
      if (action.kind === 'add') { pendingFocus.current = `schema-event-${form.events.length}-name`; setNotice('새 이벤트를 추가했어요. 이름과 표시 이름을 입력하세요.'); }
      if (action.kind === 'remove') {
        const nextIndex = Math.min(action.index, form.events.length - 2);
        pendingFocus.current = nextIndex < 0 ? 'schema-event-add' : `schema-event-${nextIndex}-name`;
        setNotice(`${action.index + 1}번 이벤트를 초안에서 삭제했어요.`);
      }
      onChange(next);
    } catch (e) { pendingFocus.current = null; setError(e instanceof Error ? e.message : '이벤트를 수정하지 못했어요.'); }
  }
  return <section className="schema-event-form" aria-labelledby="schema-event-heading">
    <div className="settings-head"><h3 id="schema-event-heading">이벤트 편집</h3><span className="settings-badge">{form.events.length} / 50</span></div>
    <p className="field-help" id="schema-event-help">이름은 코드에서 사용할 영문 이름, 표시 이름은 관리자 화면에서 볼 이름이에요. 각 이벤트의 속성 편집을 펼쳐 속성을 설정하세요. 작업 흐름·퍼널은 아래 폼에서 연결해요.</p>
    {form.events.length === 0 && <p className="notice">아직 이벤트가 없어요. 이벤트를 추가한 뒤 정의를 검증하세요.</p>}
    <div className="schema-event-list">{form.events.map((event, index) => {
      const linked = eventIsLinked(form, index), base = `schema-event-${index}`, help = `${base}-help`;
      return <fieldset className="schema-event-row" key={index}>
        <legend>{index + 1}번 이벤트</legend>
        <div className="schema-event-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-name`}>이벤트 이름</label>
            <input className="text-input" id={`${base}-name`} value={event.name} maxLength={48} autoComplete="off" spellCheck={false} readOnly={!editable || linked}
              placeholder="action_complete" aria-describedby={`schema-event-help ${help}${errorTarget === `${base}-name` ? ' schema-errors' : ''}`} aria-invalid={errorTarget === `${base}-name` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'name', value: e.target.value })} /></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-label`}>표시 이름</label>
            <input className="text-input" id={`${base}-label`} value={event.label} maxLength={80} autoComplete="off" readOnly={!editable}
              placeholder="작업 완료" aria-describedby={`schema-event-help ${help}${errorTarget === `${base}-label` ? ' schema-errors' : ''}`} aria-invalid={errorTarget === `${base}-label` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'label', value: e.target.value })} /></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-source`}>발행 출처</label>
            <select className="text-input settings-select" id={`${base}-source`} value={event.source} disabled={!editable || linked}
              aria-describedby={help} aria-invalid={errorTarget === `${base}-source` || undefined} onChange={e => change({ kind: 'edit', index, field: 'source', value: e.target.value })}>
              <option value="browser">브라우저 (browser)</option><option value="server">서버 (server)</option></select></div>
        </div>
        <div className="schema-event-footer"><p className="field-help" id={help}>속성 {Object.keys(event.properties).length}개{linked ? ' · 작업 흐름·퍼널에 연결되어 이름·출처·삭제가 잠겨 있어요.' : ''}</p>
          <button className="secondary-button" type="button" aria-label={`${index + 1}번 이벤트 삭제`} disabled={!editable || linked} onClick={() => change({ kind: 'remove', index })}>삭제</button></div>
        <SchemaPropertyForm draft={draft} eventIndex={index} editable={editable} onChange={onChange} onOpenJson={onOpenJson} issue={issue} />
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="secondary-button" type="button" id="schema-event-add" disabled={!editable || form.events.length >= 50} onClick={() => change({ kind: 'add' })}>이벤트 추가</button>
      {form.events.length >= 50 && <p className="field-help">이벤트는 최대 50개까지 등록할 수 있어요.</p>}</div>
    <p className="schema-event-notice" role="status">{notice}</p>
  </section>;
}
