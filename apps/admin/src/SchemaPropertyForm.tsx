import { useEffect, useRef, useState } from 'react';
import { readEventForm } from './api/schema-event-form.ts';
import { changePropertyForm, propertyChoices, propertyIsDimension, propertyIssueTarget, readPropertyForm } from './api/schema-property-form.ts';
import type { FormProperty, PropertyChange, PropertyRow } from './api/schema-property-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';

export default function SchemaPropertyForm({ draft, eventIndex, editable, onChange, onOpenJson, issue }: {
  draft: string; eventIndex: number; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const focus = useRef<string | null>(null), prefix = `schema-event-${eventIndex}`;
  const target = issue ? propertyIssueTarget(draft, issue) : null;
  useEffect(() => { if (target?.startsWith(`${prefix}-`)) setOpen(true); }, [target, prefix, issue]);
  useEffect(() => {
    setError('');
    if (focus.current) { document.getElementById(focus.current)?.focus(); focus.current = null; }
  }, [draft]);
  let rows: PropertyRow[];
  try { rows = readPropertyForm(readEventForm(draft), eventIndex); } catch {
    return <div className="schema-property-form"><p className="notice">이 속성 정의는 폼으로 편집할 수 없어요. 입력한 JSON은 보존했어요.</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>JSON에서 속성 확인</button></div>;
  }
  const form = readEventForm(draft), choices = rows.map(row => propertyChoices(row.definition));
  const combinations = choices.some(value => value === null) ? null : choices.reduce<number>((total, value) => Math.min(257, total * value!), 1);
  function change(action: PropertyChange) {
    if (!editable) return;
    try {
      const next = changePropertyForm(draft, eventIndex, action);
      if (action.kind === 'add') { focus.current = `${prefix}-property-${rows.length}-name`; setNotice('속성을 추가했어요. 이름과 수집 목적을 입력하세요.'); }
      if (action.kind === 'remove') {
        const index = Math.min(rows.findIndex(row => row.name === action.name), rows.length - 2);
        focus.current = index < 0 ? `${prefix}-property-add` : `${prefix}-property-${index}-name`;
        setNotice('속성을 초안에서 삭제했어요.');
      }
      onChange(next);
    } catch (e) { focus.current = null; setError(e instanceof Error ? e.message : '속성을 수정하지 못했어요.'); }
  }
  return <details className="schema-property-form" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{eventIndex + 1}번 이벤트 속성 편집 · {rows.length} / 4</summary>
    <h4 id={`${prefix}-properties-heading`} tabIndex={-1}>속성 정의</h4>
    <p className="field-help" id={`${prefix}-properties-help`}>속성마다 허용 값은 최대 32종, 이벤트의 가능한 조합은 최대 256개예요. 필수가 아니면 값이 없는 경우도 한 가지로 세요.</p>
    <p className={combinations !== null && combinations > 256 ? 'form-error' : 'field-help'}>
      {combinations === null ? '허용 값과 범위를 완성한 뒤 조합 수를 확인하세요.' : combinations > 256 ? '가능한 조합이 256개를 넘어요. 허용 값이나 속성을 줄이세요.' : `가능한 조합 ${combinations}개 / 256`}</p>
    {rows.length === 0 && <p className="field-help">아직 속성이 없어요. 이벤트를 구분하는 데 필요한 정보만 추가하세요.</p>}
    <div className="schema-property-list">{rows.map((row, index) => {
      const property = row.definition, locked = propertyIsDimension(form, eventIndex, row.name), base = `${prefix}-property-${index}`;
      const describedBy = (field: string) => `${prefix}-properties-help ${base}-help${target === `${base}-${field}` ? ' schema-errors' : ''}`;
      const input = (field: string) => ({ id: `${base}-${field}`, className: 'text-input', autoComplete: 'off',
        'aria-describedby': describedBy(field), 'aria-invalid': target === `${base}-${field}` || undefined });
      return <fieldset className="schema-property-row" key={index}><legend>{index + 1}번 속성</legend>
        <div className="schema-property-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-name`}>속성 이름</label>
            <input {...input('name')} value={row.name} maxLength={48} readOnly={!editable || locked} spellCheck={false}
              onChange={e => change({ kind: 'rename', name: row.name, value: e.target.value })} /></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-type`}>자료형</label>
            <select {...input('type')} value={property.type} disabled={!editable || locked} onChange={e => change({ kind: 'type', name: row.name, value: e.target.value as FormProperty['type'] })}>
              <option value="boolean">참·거짓 (boolean)</option><option value="enum">선택값 (enum)</option><option value="integer">정수 범위 (integer)</option></select></div>
        </div>
        <label className="schema-property-required"><input id={`${base}-required`} type="checkbox" checked={property.required} disabled={!editable || locked}
          onChange={e => change({ kind: 'required', name: row.name, value: e.target.checked })} />필수 속성</label>
        <div className="settings-field"><label className="field-label" htmlFor={`${base}-purpose`}>수집 목적</label>
          <textarea {...input('purpose')} rows={2} maxLength={240} value={property.purpose} readOnly={!editable}
            placeholder="예: 공개된 파일 형식별 완료 건수 비교" onChange={e => change({ kind: 'purpose', name: row.name, value: e.target.value })} /></div>
        {property.type === 'enum' && <div className="settings-field"><label className="field-label" htmlFor={`${base}-values`}>허용 값 (한 줄에 하나)</label>
          <textarea {...input('values')} rows={3} value={property.values!.join('\n')} readOnly={!editable || locked} spellCheck={false} placeholder={'pdf\npng\njpg'}
            onChange={e => change({ kind: 'values', name: row.name, value: e.target.value })} />
          <p className="field-help">소문자·숫자로 시작하고 소문자·숫자·밑줄·하이픈을 사용하세요. 각 값은 최대 32자이며 빈 줄·중복은 허용하지 않아요.</p></div>}
        {property.type === 'integer' && <div className="schema-property-fields">{(['minimum', 'maximum'] as const).map(field => <div className="settings-field" key={field}>
          <label className="field-label" htmlFor={`${base}-${field}`}>{field === 'minimum' ? '최솟값' : '최댓값'}</label>
          <input {...input(field)} value={property[field]} inputMode="text" readOnly={!editable || locked} onChange={e => change({ kind: field, name: row.name, value: e.target.value })} />
        </div>)}</div>}
        <p className="field-help" id={`${base}-help`}>이름은 영문 소문자로 시작하는 48자 이내 이름이에요. 개인 정보·원시 입력값 대신 수집 목적과 허용 범주만 정의하세요.
          {locked ? ' 작업 흐름의 비교 기준이라 목적만 수정할 수 있어요. 연결된 정의 변경은 JSON에서 함께 수정하세요.' : ' 자료형을 바꾸면 해당 자료형의 허용 값·범위를 새로 설정해요.'}</p>
        <div className="schema-event-footer"><span className="field-help">{property.type === 'integer' ? '정수 범위: −1,000,000~1,000,000 · 최대 32종' : `허용 값 ${property.type === 'boolean' ? 2 : property.values!.length}종 / 32`}</span>
          <button className="secondary-button" type="button" aria-label={`${eventIndex + 1}번 이벤트 ${index + 1}번 속성 삭제`} disabled={!editable || locked} onClick={() => change({ kind: 'remove', name: row.name })}>속성 삭제</button></div>
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="secondary-button" type="button" id={`${prefix}-property-add`} aria-label={`${eventIndex + 1}번 이벤트 속성 추가`} disabled={!editable || rows.length >= 4} onClick={() => change({ kind: 'add' })}>속성 추가</button>
    <p role="status">{notice}</p>
  </details>;
}
