import { useEffect, useRef, useState } from 'react';
import { changeEventForm, eventIsLinked, eventIssueTarget, readEventForm } from './api/schema-event-form.ts';
import type { EventChange, EventFormDraft } from './api/schema-event-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';
import SchemaPropertyForm from './SchemaPropertyForm.tsx';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

export default function SchemaEventForm({ draft, editable, onChange, onOpenJson, issue }: {
  draft: string; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [error, setError] = useState<{ message: string } | { local: true } | null>(null), [notice, setNotice] = useState<{ key: 'added' } | { key: 'removed'; index: number } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setError(null);
    if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [draft]);
  let form: EventFormDraft;
  try { form = readEventForm(draft); } catch {
    return <section className="schema-event-form" aria-labelledby="schema-event-heading">
      <h3 id="schema-event-heading">{t('settings:editEvents')}</h3><p className="notice">{t('settings:eventFormUnavailable')}</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>{t('settings:openJsonEditor')}</button>
    </section>;
  }
  const errorTarget = issue ? eventIssueTarget(draft, issue) : null;
  function change(action: EventChange) {
    if (!editable) return;
    try {
      const next = changeEventForm(draft, action);
      if (action.kind === 'add') { pendingFocus.current = `schema-event-${form.events.length}-name`; setNotice({ key: 'added' }); }
      if (action.kind === 'remove') {
        const nextIndex = Math.min(action.index, form.events.length - 2);
        pendingFocus.current = nextIndex < 0 ? 'schema-event-add' : `schema-event-${nextIndex}-name`;
        setNotice({ key: 'removed', index: action.index + 1 });
      }
      onChange(next);
    } catch (e) { pendingFocus.current = null; setError(e instanceof Error ? { message: e.message } : { local: true }); }
  }
  return <section className="schema-event-form" aria-labelledby="schema-event-heading">
    <div className="settings-head"><h3 id="schema-event-heading">{t('settings:editEvents')}</h3><span className="settings-badge">{form.events.length} / 50</span></div>
    <p className="field-help" id="schema-event-help">{t('settings:eventFormHelp')}</p>
    {form.events.length === 0 && <p className="notice">{t('settings:noEvents')}</p>}
    <div className="schema-event-list">{form.events.map((event, index) => {
      const linked = eventIsLinked(form, index), base = `schema-event-${index}`, help = `${base}-help`;
      return <fieldset className="schema-event-row" key={index}>
        <legend>{t('settings:eventNumber', { index: index + 1 })}</legend>
        <div className="schema-event-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-name`}>{t('settings:eventName')}</label>
            <input className="text-input" id={`${base}-name`} value={event.name} maxLength={48} autoComplete="off" spellCheck={false} readOnly={!editable || linked}
              placeholder="action_complete" aria-describedby={`schema-event-help ${help}${errorTarget === `${base}-name` ? ' schema-errors' : ''}`} aria-invalid={errorTarget === `${base}-name` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'name', value: e.target.value })} /></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-label`}>{t('settings:displayName')}</label>
            <input className="text-input" id={`${base}-label`} value={event.label} maxLength={80} autoComplete="off" readOnly={!editable}
              placeholder={t('settings:eventLabelPlaceholder')} aria-describedby={`schema-event-help ${help}${errorTarget === `${base}-label` ? ' schema-errors' : ''}`} aria-invalid={errorTarget === `${base}-label` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'label', value: e.target.value })} /></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-source`}>{t('settings:publishSource')}</label>
            <select className="text-input settings-select" id={`${base}-source`} value={event.source} disabled={!editable || linked}
              aria-describedby={help} aria-invalid={errorTarget === `${base}-source` || undefined} onChange={e => change({ kind: 'edit', index, field: 'source', value: e.target.value })}>
              <option value="browser">{t('settings:browserOption')}</option><option value="server">{t('settings:serverOption')}</option></select></div>
        </div>
        <div className="schema-event-footer"><p className="field-help" id={help}>{t('settings:eventPropertyCount', { count: Object.keys(event.properties).length })}{linked ? t('settings:eventLinkedHelp') : ''}</p>
          <button className="secondary-button" type="button" aria-label={t('settings:removeEventLabel', { index: index + 1 })} disabled={!editable || linked} onClick={() => change({ kind: 'remove', index })}>{t('settings:remove')}</button></div>
        <SchemaPropertyForm draft={draft} eventIndex={index} editable={editable} onChange={onChange} onOpenJson={onOpenJson} issue={issue} />
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{'message' in error ? messageText(error.message) : t('settings:eventUpdateFailed')}</p>}
    <div className="form-actions"><button className="secondary-button" type="button" id="schema-event-add" disabled={!editable || form.events.length >= 50} onClick={() => change({ kind: 'add' })}>{t('settings:addEvent')}</button>
      {form.events.length >= 50 && <p className="field-help">{t('settings:eventLimitReached')}</p>}</div>
    <p className="schema-event-notice" role="status">{notice ? notice.key === 'added' ? t('settings:eventAdded') : t('settings:eventRemoved', { index: notice.index }) : ''}</p>
  </section>;
}
