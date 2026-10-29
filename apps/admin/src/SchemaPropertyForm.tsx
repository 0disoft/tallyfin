import { useEffect, useRef, useState } from 'react';
import { readEventForm } from './api/schema-event-form.ts';
import { changePropertyForm, propertyChoices, propertyIsDimension, propertyIssueTarget, readPropertyForm } from './api/schema-property-form.ts';
import type { FormProperty, PropertyChange, PropertyRow } from './api/schema-property-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

export default function SchemaPropertyForm({ draft, eventIndex, editable, onChange, onOpenJson, issue }: {
  draft: string; eventIndex: number; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [error, setError] = useState<{ message: string } | { local: true } | null>(null), [notice, setNotice] = useState<'added' | 'removed' | null>(null);
  const focus = useRef<string | null>(null), prefix = `schema-event-${eventIndex}`;
  const target = issue ? propertyIssueTarget(draft, issue) : null;
  useEffect(() => {
    setError(null);
    if (focus.current) { document.getElementById(focus.current)?.focus(); focus.current = null; }
  }, [draft]);
  let rows: PropertyRow[];
  try { rows = readPropertyForm(readEventForm(draft), eventIndex); } catch {
    return <div className="schema-property-form"><p className="notice">{t('settings:propertyFormUnavailable')}</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>{t('settings:checkPropertyInJson')}</button></div>;
  }
  const form = readEventForm(draft), choices = rows.map(row => propertyChoices(row.definition));
  const combinations = choices.some(value => value === null) ? null : choices.reduce<number>((total, value) => Math.min(257, total * value!), 1);
  function change(action: PropertyChange) {
    if (!editable) return;
    try {
      const next = changePropertyForm(draft, eventIndex, action);
      if (action.kind === 'add') { focus.current = `${prefix}-property-${rows.length}-name`; setNotice('added'); }
      if (action.kind === 'remove') {
        const index = Math.min(rows.findIndex(row => row.name === action.name), rows.length - 2);
        focus.current = index < 0 ? `${prefix}-property-add` : `${prefix}-property-${index}-name`;
        setNotice('removed');
      }
      onChange(next);
    } catch (e) { focus.current = null; setError(e instanceof Error ? { message: e.message } : { local: true }); }
  }
  return <section className="schema-property-form" aria-labelledby={`${prefix}-properties-heading`}>
    <h4 id={`${prefix}-properties-heading`} tabIndex={-1}>{t('settings:propertyEditorSummary', { event: eventIndex + 1, count: rows.length })}</h4>
    <p className="field-help" id={`${prefix}-properties-help`}>{t('settings:propertyLimitsHelp')}</p>
    <p className={combinations !== null && combinations > 256 ? 'form-error' : 'field-help'}>
      {combinations === null ? t('settings:combinationsIncomplete') : combinations > 256 ? t('settings:combinationsExceeded') : t('settings:combinationsCount', { count: combinations })}</p>
    {rows.length === 0 && <p className="field-help">{t('settings:noProperties')}</p>}
    <div className="schema-property-list">{rows.map((row, index) => {
      const property = row.definition, locked = propertyIsDimension(form, eventIndex, row.name), base = `${prefix}-property-${index}`;
      const describedBy = (field: string) => `${prefix}-properties-help ${base}-help${target === `${base}-${field}` ? ' schema-errors' : ''}`;
      const input = (field: string) => ({ id: `${base}-${field}`, className: 'text-input', autoComplete: 'off',
        'aria-describedby': describedBy(field), 'aria-invalid': target === `${base}-${field}` || undefined });
      return <fieldset className="schema-property-row" key={index}><legend>{t('settings:propertyNumber', { index: index + 1 })}</legend>
        <div className="schema-property-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-name`}>{t('settings:propertyName')}</label>
            <input {...input('name')} value={row.name} maxLength={48} readOnly={!editable || locked} spellCheck={false}
              onChange={e => change({ kind: 'rename', name: row.name, value: e.target.value })} /></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-type`}>{t('settings:propertyType')}</label>
            <select {...input('type')} value={property.type} disabled={!editable || locked} onChange={e => change({ kind: 'type', name: row.name, value: e.target.value as FormProperty['type'] })}>
              <option value="boolean">{t('settings:typeBoolean')}</option><option value="enum">{t('settings:typeEnum')}</option><option value="integer">{t('settings:typeInteger')}</option></select></div>
        </div>
        <label className="schema-property-required"><input id={`${base}-required`} type="checkbox" checked={property.required} disabled={!editable || locked}
          onChange={e => change({ kind: 'required', name: row.name, value: e.target.checked })} />{t('settings:requiredProperty')}</label>
        <div className="settings-field"><label className="field-label" htmlFor={`${base}-purpose`}>{t('settings:collectionPurpose')}</label>
          <textarea {...input('purpose')} rows={2} maxLength={240} value={property.purpose} readOnly={!editable}
            placeholder={t('settings:purposePlaceholder')} onChange={e => change({ kind: 'purpose', name: row.name, value: e.target.value })} /></div>
        {property.type === 'enum' && <div className="settings-field"><label className="field-label" htmlFor={`${base}-values`}>{t('settings:allowedValues')}</label>
          <textarea {...input('values')} rows={3} value={property.values!.join('\n')} readOnly={!editable || locked} spellCheck={false} placeholder={'pdf\npng\njpg'}
            onChange={e => change({ kind: 'values', name: row.name, value: e.target.value })} />
          <p className="field-help">{t('settings:allowedValuesHelp')}</p></div>}
        {property.type === 'integer' && <div className="schema-property-fields">{(['minimum', 'maximum'] as const).map(field => <div className="settings-field" key={field}>
          <label className="field-label" htmlFor={`${base}-${field}`}>{field === 'minimum' ? t('settings:minimum') : t('settings:maximum')}</label>
          <input {...input(field)} value={property[field]} inputMode="text" readOnly={!editable || locked} onChange={e => change({ kind: field, name: row.name, value: e.target.value })} />
        </div>)}</div>}
        <p className="field-help" id={`${base}-help`}>{t('settings:propertyNameHelp')}{locked ? t('settings:propertyLockedHelp') : t('settings:propertyTypeChangeHelp')}</p>
        <div className="schema-event-footer"><span className="field-help">{property.type === 'integer' ? t('settings:integerRangeHelp') : t('settings:allowedValueCount', { count: property.type === 'boolean' ? 2 : property.values!.length })}</span>
          <button className="secondary-button" type="button" aria-label={t('settings:removePropertyLabel', { event: eventIndex + 1, index: index + 1 })} disabled={!editable || locked} onClick={() => change({ kind: 'remove', name: row.name })}>{t('settings:removeProperty')}</button></div>
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{'message' in error ? messageText(error.message) : t('settings:propertyUpdateFailed')}</p>}
    <button className="secondary-button" type="button" id={`${prefix}-property-add`} aria-label={t('settings:addPropertyLabel', { event: eventIndex + 1 })} disabled={!editable || rows.length >= 4} onClick={() => change({ kind: 'add' })}>{t('settings:addProperty')}</button>
    <p role="status">{notice ? t(notice === 'added' ? 'settings:propertyAdded' : 'settings:propertyRemoved') : ''}</p>
  </section>;
}
