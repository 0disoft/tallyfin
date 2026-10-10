import { useEffect, useRef, useState } from 'react';
import { changeFunnelForm, funnelDimensionChoices, funnelEventChoices, funnelFocusAfterChange, funnelIssueTarget, funnelWarnings, readFunnelForm } from './api/schema-funnel-form.ts';
import type { FunnelChange, FunnelFormDraft } from './api/schema-funnel-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';
import './schema-funnels.css';

export default function SchemaFunnelForm({ draft, editable, onChange, onOpenJson, issue }: {
  draft: string; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setError('');
    if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [draft]);
  let form: FunnelFormDraft;
  try { form = readFunnelForm(draft); } catch {
    return <section className="schema-funnel-form" aria-labelledby="schema-funnel-heading">
      <h3 id="schema-funnel-heading" tabIndex={-1}>퍼널 단계 편집</h3>
      <p className="notice">JSON 형식이나 퍼널 항목을 확인해야 폼으로 편집할 수 있어요. 입력한 초안은 그대로 보관하고 있어요.</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>JSON 직접 편집 열기</button>
    </section>;
  }
  const funnels = form.funnels ?? [], events = funnelEventChoices(form), errorTarget = issue ? funnelIssueTarget(draft, issue) : null;
  function change(action: FunnelChange) {
    if (!editable) return;
    try {
      const next = changeFunnelForm(draft, action);
      pendingFocus.current = funnelFocusAfterChange(action, funnels.length, 'index' in action ? funnels[action.index]?.steps.length : 0);
      if (action.kind === 'add') setNotice('새 퍼널과 두 단계를 추가했어요. 이름과 단계 이벤트를 선택하세요.');
      if (action.kind === 'remove') setNotice(`${action.index + 1}번 퍼널을 초안에서 삭제했어요.`);
      if (action.kind === 'add-step') setNotice('새 단계를 추가했어요. 이벤트를 선택하세요.');
      if (action.kind === 'remove-step') setNotice(`${action.step + 1}번 단계를 초안에서 삭제했어요.`);
      if (action.kind === 'move-step') setNotice(`${action.step + 1}번 단계를 ${action.step + action.direction + 1}번 위치로 옮겼어요.`);
      onChange(next);
    } catch (e) { pendingFocus.current = null; setError(e instanceof Error ? e.message : '퍼널을 수정하지 못했어요.'); }
  }
  return <section className="schema-funnel-form" aria-labelledby="schema-funnel-heading">
    <div className="settings-head"><h3 id="schema-funnel-heading" tabIndex={-1}>퍼널 단계 편집</h3><span className="settings-badge">{funnels.length} / 10</span></div>
    <p className="field-help" id="schema-funnel-help">퍼널은 하나의 작업이 거치는 2~10개 단계를 순서대로 연결해요. 브라우저·서버 이벤트를 함께 사용할 수 있어요. 단계 이벤트는 같은 퍼널 안에서 중복 없이 선택하세요.</p>
    <p className="field-help">첫 단계부터 24시간 안의 진행을 집계해요. 정의를 발행한 뒤 SDK 연결 안내에 따라 작업 연결 정보를 전달해야 단계가 이어져요.</p>
    {funnels.length === 0 && <p className="notice">아직 퍼널이 없어요. 퍼널을 추가한 뒤 단계 이벤트를 선택하세요.</p>}
    <div className="schema-funnel-list">{funnels.map((funnel, index) => {
      const base = `schema-funnel-${index}`, warnings = funnelWarnings(form, index), dimensions = funnelDimensionChoices(form, index);
      const dimensionWarning = warnings.filter(w => w.field === 'dimensions').map(w => w.message).join(' ');
      const described = (id: string, extra: string[] = []) => ['schema-funnel-help', ...extra, ...(errorTarget === id ? ['schema-errors'] : [])].join(' ');
      return <fieldset className="schema-funnel-row" key={index}>
        <legend>{index + 1}번 퍼널</legend>
        <div className="schema-funnel-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-id`}>퍼널 ID</label>
            <input className="text-input" id={`${base}-id`} value={funnel.id} maxLength={48} autoComplete="off" spellCheck={false} readOnly={!editable}
              placeholder="file_conversion" aria-describedby={described(`${base}-id`, [`${base}-id-help`])} aria-invalid={errorTarget === `${base}-id` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'id', value: e.target.value })} />
            <p className="field-help" id={`${base}-id-help`}>영문 소문자로 시작하는 48자 이내 이름이에요. 소문자·숫자·밑줄만 써요.</p></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-label`}>표시 이름</label>
            <input className="text-input" id={`${base}-label`} value={funnel.label} maxLength={80} autoComplete="off" readOnly={!editable}
              placeholder="파일 변환 과정" aria-describedby={described(`${base}-label`)} aria-invalid={errorTarget === `${base}-label` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'label', value: e.target.value })} /></div>
        </div>
        <ol className="schema-funnel-steps">{funnel.steps.map((step, stepIndex) => {
          const id = `${base}-step-${stepIndex}-event`, warning = warnings.filter(w => w.field === 'steps' && w.step === stepIndex).map(w => w.message).join(' ');
          const value = `${step.source}:${step.eventName}`, missing = step.eventName !== '' && !events.some(e => e.name === step.eventName && e.source === step.source);
          return <li className="schema-funnel-step" key={stepIndex}>
            <div className="settings-field"><label className="field-label" htmlFor={id}>단계 {stepIndex + 1} · {stepIndex === 0 ? '시작' : stepIndex === funnel.steps.length - 1 ? '완료' : '중간 단계'}</label>
              <select className="text-input settings-select" id={id} value={step.eventName === '' ? '' : value} disabled={!editable}
                aria-describedby={described(id, warning ? [`${id}-warning`] : [])} aria-invalid={errorTarget === id || undefined}
                onChange={e => { const selected = events.find(event => `${event.source}:${event.name}` === e.target.value);
                  if (selected) change({ kind: 'event', index, step: stepIndex, eventName: selected.name, source: selected.source }); }}>
                <option value="" disabled>등록된 이벤트를 선택하세요</option>
                {(['browser', 'server'] as const).map(source => <optgroup key={source} label={source === 'browser' ? '브라우저 이벤트' : '서버 이벤트'}>
                  {events.filter(e => e.source === source).map(e => <option key={`${source}:${e.name}`} value={`${source}:${e.name}`}>
                    {e.label.trim() && e.label !== e.name ? `${e.label} (${e.name})` : e.name} · {source === 'browser' ? '브라우저' : '서버'}
                  </option>)}
                </optgroup>)}
                {missing && <option value={value}>{step.eventName} · {step.source} (사용할 수 없음)</option>}
              </select>
              {warning && <p className="schema-funnel-warning" id={`${id}-warning`}>{warning}</p>}
            </div>
            <div className="schema-funnel-step-actions">
              <button className="secondary-button" type="button" disabled={!editable || stepIndex === 0}
                aria-label={`${index + 1}번 퍼널 단계 ${stepIndex + 1} 위로 이동`} onClick={() => change({ kind: 'move-step', index, step: stepIndex, direction: -1 })}>위로</button>
              <button className="secondary-button" type="button" disabled={!editable || stepIndex === funnel.steps.length - 1}
                aria-label={`${index + 1}번 퍼널 단계 ${stepIndex + 1} 아래로 이동`} onClick={() => change({ kind: 'move-step', index, step: stepIndex, direction: 1 })}>아래로</button>
              <button className="secondary-button" type="button" disabled={!editable || funnel.steps.length <= 2}
                aria-label={`${index + 1}번 퍼널 단계 ${stepIndex + 1} 삭제`} onClick={() => change({ kind: 'remove-step', index, step: stepIndex })}>단계 삭제</button>
            </div>
          </li>;
        })}</ol>
        <button className="secondary-button" type="button" id={`${base}-add-step`} disabled={!editable || funnel.steps.length >= 10}
          onClick={() => change({ kind: 'add-step', index })}>단계 추가</button>
        {warnings.filter(w => w.field === 'steps' && w.step === undefined).map((w, i) => <p className="schema-funnel-warning" key={i}>{w.message}</p>)}
        <div className="settings-field schema-funnel-dimension-field">
          <span className="field-label" id={`${base}-dimensions-label`}>비교 기준 속성</span>
          <div className="schema-funnel-dimensions" role="group" id={`${base}-dimensions`} tabIndex={-1} aria-labelledby={`${base}-dimensions-label`}
            aria-describedby={described(`${base}-dimensions`, [`${base}-dimensions-help`, ...(dimensionWarning ? [`${base}-dimensions-warning`] : [])])}
            aria-invalid={errorTarget === `${base}-dimensions` || undefined}>
            {dimensions.length === 0 ? <p className="field-help">단계 이벤트의 필수 속성을 비교 기준으로 선택할 수 있어요.</p> : dimensions.map(key => {
              const checked = funnel.dimensions.includes(key);
              return <label className="schema-funnel-dimension" key={key}><input type="checkbox" checked={checked} disabled={!editable || (!checked && funnel.dimensions.length >= 4)}
                onChange={e => change({ kind: 'dimensions', index, value: e.target.checked ? [...funnel.dimensions, key] : funnel.dimensions.filter(d => d !== key) })} />{key}</label>;
            })}
          </div>
          <p className="field-help" id={`${base}-dimensions-help`}>최대 4개. 모든 단계에 같은 자료형과 허용 값을 가진 필수 속성이 필요해요. 현재 퍼널 분석 화면은 모든 속성 값을 합쳐서 보여줘요.</p>
          {dimensionWarning && <p className="schema-funnel-warning" id={`${base}-dimensions-warning`}>{dimensionWarning}</p>}
        </div>
        <button className="secondary-button" type="button" disabled={!editable} aria-label={`${index + 1}번 퍼널 삭제`} onClick={() => change({ kind: 'remove', index })}>퍼널 삭제</button>
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="secondary-button" type="button" id="schema-funnel-add" disabled={!editable || funnels.length >= 10} onClick={() => change({ kind: 'add' })}>퍼널 추가</button>
    <p className="field-help">표시되는 경고는 참고용이에요. 최종 판정은 아래 정의 검증에서 확인하세요.</p>
    <p className="schema-funnel-notice" role="status">{notice}</p>
  </section>;
}
