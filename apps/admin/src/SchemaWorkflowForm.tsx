import { useEffect, useRef, useState } from 'react';
import { changeWorkflowForm, readWorkflowForm, workflowDimensionChoices, workflowFailureReasonChoices, workflowFocusAfterChange, workflowIssueTarget, workflowWarnings } from './api/schema-workflow-form.ts';
import type { WorkflowChange, WorkflowFormDraft, WorkflowPhase } from './api/schema-workflow-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';

const PHASES: WorkflowPhase[] = ['startEvent', 'successEvent', 'failureEvent'];
const PHASE_LABEL: Record<WorkflowPhase, string> = { startEvent: '시작 이벤트', successEvent: '성공 이벤트', failureEvent: '실패 이벤트' };
const PHASE_PLACEHOLDER: Record<WorkflowPhase, string> = { startEvent: '브라우저 이벤트를 선택하세요', successEvent: '브라우저 이벤트를 선택하세요', failureEvent: '실패 이벤트를 선택하세요' };
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
/** Null failure cannot be an option value, so it maps to a sentinel that no valid event name can match. */
const NO_FAILURE = '@none';

export default function SchemaWorkflowForm({ draft, editable, onChange, onOpenJson, issue }: {
  draft: string; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setError('');
    if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [draft]);
  let form: WorkflowFormDraft;
  try { form = readWorkflowForm(draft); } catch {
    return <section className="schema-workflow-form" aria-labelledby="schema-workflow-heading">
      <h3 id="schema-workflow-heading" tabIndex={-1}>작업 흐름 편집</h3>
      <p className="notice">JSON 형식이나 작업 흐름 항목을 확인해야 폼으로 편집할 수 있어요. 입력한 초안은 그대로 보관하고 있어요.</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>JSON 직접 편집 열기</button>
    </section>;
  }
  const errorTarget = issue ? workflowIssueTarget(draft, issue) : null;
  function change(action: WorkflowChange) {
    if (!editable) return;
    try {
      const next = changeWorkflowForm(draft, action);
      if (action.kind === 'add') { pendingFocus.current = workflowFocusAfterChange(action, form.workflows.length); setNotice('새 작업 흐름을 추가했어요. ID와 표시 이름을 입력하세요.'); }
      else if (action.kind === 'remove') { pendingFocus.current = workflowFocusAfterChange(action, form.workflows.length);
        setNotice(Object.hasOwn(form, 'representativeWorkflowId') && !Object.hasOwn(JSON.parse(next), 'representativeWorkflowId')
          ? '대표 작업 흐름을 삭제해 대표 지정도 해제했어요. 다른 흐름을 선택할 수 있어요.' : `${action.index + 1}번 작업 흐름을 초안에서 삭제했어요.`); }
      else if (action.kind === 'representative') setNotice(action.value ? '초안의 대표 작업 흐름을 선택했어요. 발행 후 개요에 반영돼요.' : '초안의 대표 흐름 지정을 해제했어요.');
      onChange(next);
    } catch (e) {
      pendingFocus.current = null;
      setError(e instanceof Error ? e.message : '작업 흐름을 수정하지 못했어요.');
      if (action.kind === 'edit' && action.field === 'id') {
        const target = `schema-workflow-${action.index}-id`;
        requestAnimationFrame(() => document.getElementById(target)?.focus());
      }
    }
  }
  const browserEvents = form.events.filter(event => event.source === 'browser' && NAME.test(event.name))
    .filter((event, index, list) => list.findIndex(item => item.name === event.name) === index);
  const representatives = form.workflows.filter(workflow => NAME.test(workflow.id) && form.workflows.filter(w => w.id === workflow.id).length === 1);
  const representative = typeof form.representativeWorkflowId === 'string' ? form.representativeWorkflowId : '';
  const invalidRepresentative = Object.hasOwn(form, 'representativeWorkflowId') && !representatives.some(w => w.id === representative);
  return <section className="schema-workflow-form" aria-labelledby="schema-workflow-heading">
    <div className="settings-head"><h3 id="schema-workflow-heading" tabIndex={-1}>작업 흐름 편집</h3><span className="settings-badge">{form.workflows.length} / 10</span></div>
    <p className="field-help" id="schema-workflow-help">작업 흐름은 브라우저 이벤트를 시작·성공·실패 단계로 연결해요. 비교 기준은 단계마다 같은 필수 속성이어야 해요. 표시되는 경고는 참고용이고 최종 판정은 서버 검증에서 확인하세요.</p>
    <div className="settings-field"><label className="field-label" htmlFor="schema-representative-workflow">개요의 대표 작업 흐름</label>
      <select className="text-input settings-select" id="schema-representative-workflow" value={representative} disabled={!editable}
        aria-invalid={invalidRepresentative || errorTarget === 'schema-representative-workflow' || undefined}
        aria-describedby={`schema-representative-help${invalidRepresentative ? ' schema-representative-warning' : ''}${errorTarget === 'schema-representative-workflow' ? ' schema-errors' : ''}`}
        onChange={event => change({ kind: 'representative', value: event.target.value })}>
        <option value="">대표 흐름 미지정</option>
        {representatives.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label.trim() ? `${workflow.label} (${workflow.id})` : workflow.id}</option>)}
        {invalidRepresentative && representative !== '' && <option value={representative}>{representative} (사용할 수 없음)</option>}
      </select>
      <p className="field-help" id="schema-representative-help">서비스 통합 현황과 서비스 개요의 완료율에 사용할 흐름이에요. 새 버전 발행 후 반영돼요. 미지정이면 완료율을 표시하지 않으며, 목표 화면에서는 모든 흐름을 조회해요.</p>
      {invalidRepresentative && <p className="schema-workflow-warning" id="schema-representative-warning">대표 흐름 ID가 이 초안의 고유한 흐름을 가리키지 않아요. 다시 선택하거나 지정을 해제하세요.</p>}
    </div>
    {form.workflows.length === 0 && <p className="notice">아직 작업 흐름이 없어요. 흐름을 추가한 뒤 정의를 검증하세요.</p>}
    <div className="schema-workflow-list">{form.workflows.map((workflow, index) => {
      const base = `schema-workflow-${index}`, choices = workflowDimensionChoices(form, index), atMax = workflow.dimensions.length >= 4;
      /** A raw failure string equal to the sentinel would otherwise render as "no failure", so shift the sentinel for that row. */
      const noFailure = workflow.failureEvent === NO_FAILURE ? '@none-alt' : NO_FAILURE;
      const warnings = workflowWarnings(form, index), dimensionWarning = warnings.filter(item => item.field === 'dimensions').map(item => item.message).join(' ');
      const reasonChoices = workflowFailureReasonChoices(form, index), reason = workflow.failureReasonProperty ?? '';
      const reasonInvalid = Object.hasOwn(workflow, 'failureReasonProperty') && !reasonChoices.includes(reason);
      const described = (id: string, extra: string[] = []) => ['schema-workflow-help', `${base}-help`, ...extra, ...(errorTarget === id ? ['schema-errors'] : [])].join(' ');
      return <fieldset className="schema-workflow-row" key={index}>
        <legend>{index + 1}번 작업 흐름</legend>
        <div className="schema-workflow-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-id`}>작업 흐름 ID</label>
            <input className="text-input" id={`${base}-id`} value={workflow.id} maxLength={48} autoComplete="off" spellCheck={false} readOnly={!editable}
              placeholder="checkout_flow" aria-describedby={described(`${base}-id`, [`${base}-id-help`])} aria-invalid={errorTarget === `${base}-id` || undefined}
              onChange={event => change({ kind: 'edit', index, field: 'id', value: event.target.value })} />
            <p className="field-help" id={`${base}-id-help`}>영문 소문자로 시작하는 48자 이내 이름이에요. 소문자·숫자·밑줄만 써요.</p></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-label`}>표시 이름</label>
            <input className="text-input" id={`${base}-label`} value={workflow.label} maxLength={80} autoComplete="off" readOnly={!editable}
              placeholder="결제 완료 흐름" aria-describedby={described(`${base}-label`, [`${base}-label-help`])} aria-invalid={errorTarget === `${base}-label` || undefined}
              onChange={event => change({ kind: 'edit', index, field: 'label', value: event.target.value })} />
            <p className="field-help" id={`${base}-label-help`}>관리자 화면에서 볼 이름이에요. 1~80자까지 입력해요.</p></div>
        </div>
        <div className="schema-workflow-phases">{PHASES.map(phase => {
          const id = `${base}-${phase}`, value = workflow[phase], sentinel = phase === 'failureEvent' ? noFailure : NO_FAILURE;
          const warning = warnings.filter(item => item.field === phase).map(item => item.message).join(' ');
          const missing = typeof value === 'string' && value !== '' && !browserEvents.some(event => event.name === value) ? value : null;
          return <div className="settings-field" key={phase}><label className="field-label" htmlFor={id}>{PHASE_LABEL[phase]}</label>
            <select className="text-input settings-select" id={id} value={value === null ? sentinel : value} disabled={!editable}
              aria-describedby={described(id, warning ? [`${id}-warning`] : [])} aria-invalid={errorTarget === id || undefined}
              onChange={event => change({ kind: 'edit', index, field: phase, value: phase === 'failureEvent' && event.target.value === sentinel ? null : event.target.value })}>
              <option value="">{PHASE_PLACEHOLDER[phase]}</option>
              {phase === 'failureEvent' && <option value={sentinel}>실패 단계 없음</option>}
              {browserEvents.map(event => <option key={event.name} value={event.name}>{event.label.trim() ? `${event.label} (${event.name})` : event.name}</option>)}
              {missing !== null && <option value={missing}>{missing} (사용할 수 없음)</option>}
            </select>
            {warning && <p className="schema-workflow-warning" id={`${id}-warning`}>{warning}</p>}</div>;
        })}</div>
        <div className="settings-field"><label className="field-label" htmlFor={`${base}-failureReasonProperty`}>실패 원인 속성</label>
          <select className="text-input settings-select" id={`${base}-failureReasonProperty`} value={reason} disabled={!editable}
            aria-invalid={reasonInvalid || errorTarget === `${base}-failureReasonProperty` || undefined}
            aria-describedby={described(`${base}-failureReasonProperty`, [`${base}-reason-help`, ...(reasonInvalid ? [`${base}-reason-warning`] : [])])}
            onChange={event => change({ kind: 'failureReason', index, value: event.target.value })}>
            <option value="">실패 원인 집계 안 함</option>
            {reasonChoices.map(name => <option key={name} value={name}>{name}</option>)}
            {reasonInvalid && reason !== '' && <option value={reason}>{reason} (사용할 수 없음)</option>}
          </select>
          <p className="field-help" id={`${base}-reason-help`}>실패 이벤트의 enum 속성 하나를 선택해요. 새 버전 발행 이후 최초 실패 원인만 집계하며, 원인 누락과 과거 미측정을 구별해요.</p>
          {reasonInvalid && <p className="schema-workflow-warning" id={`${base}-reason-warning`}>실패 이벤트의 enum 속성을 다시 선택하거나 원인 집계를 해제하세요.</p>}
        </div>
        <div className="settings-field schema-workflow-dimension-field">
          <span className="field-label" id={`${base}-dimensions-label`}>비교 기준 속성</span>
          <div className="schema-workflow-dimensions" id={`${base}-dimensions`} role="group" tabIndex={-1} aria-labelledby={`${base}-dimensions-label`}
            aria-describedby={described(`${base}-dimensions`, [`${base}-dimensions-help`, ...(dimensionWarning ? [`${base}-dimensions-warning`] : [])])}
            aria-invalid={errorTarget === `${base}-dimensions` || undefined}>
            {choices.length === 0 ? <p className="field-help">단계 이벤트에 필수 속성이 있어야 비교 기준을 고를 수 있어요.</p>
              : choices.map(key => {
                const checked = workflow.dimensions.includes(key);
                return <label className="schema-workflow-dimension" key={key}>
                  <input type="checkbox" checked={checked} disabled={!editable || (!checked && atMax)}
                    onChange={event => change({ kind: 'dimensions', index, value: event.target.checked ? [...workflow.dimensions, key] : workflow.dimensions.filter(item => item !== key) })} />
                  <span className="schema-workflow-dimension-name">{key}</span></label>;
              })}
          </div>
          <p className="field-help" id={`${base}-dimensions-help`}>단계마다 같은 자료형·허용 값을 가진 필수 속성만 비교 기준으로 사용할 수 있어요. 최대 4개까지 선택하고, 선택한 항목은 다시 눌러 해제해요.</p>
          {dimensionWarning && <p className="schema-workflow-warning" id={`${base}-dimensions-warning`}>{dimensionWarning}</p>}
        </div>
        <div className="schema-event-footer"><p className="field-help" id={`${base}-help`}>비교 기준 {workflow.dimensions.length} / 4</p>
          <button className="secondary-button" type="button" aria-label={`${index + 1}번 작업 흐름 삭제`} disabled={!editable} onClick={() => change({ kind: 'remove', index })}>삭제</button></div>
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="secondary-button" type="button" id="schema-workflow-add" disabled={!editable || form.workflows.length >= 10} onClick={() => change({ kind: 'add' })}>작업 흐름 추가</button>
      {form.workflows.length >= 10 && <p className="field-help">작업 흐름은 최대 10개까지 등록할 수 있어요.</p>}</div>
    <p className="schema-workflow-notice" role="status">{notice}</p>
  </section>;
}
