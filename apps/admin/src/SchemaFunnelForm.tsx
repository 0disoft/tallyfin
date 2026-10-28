import { useEffect, useRef, useState } from 'react';
import { changeFunnelForm, funnelDimensionChoices, funnelEventChoices, funnelFocusAfterChange, funnelIssueTarget, funnelWarnings, readFunnelForm } from './api/schema-funnel-form.ts';
import type { FunnelChange, FunnelFormDraft } from './api/schema-funnel-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';
import './schema-funnels.css';

export default function SchemaFunnelForm({ draft, editable, onChange, onOpenJson, issue }: {
  draft: string; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [error, setError] = useState<{ message: string } | { local: true } | null>(null), [notice, setNotice] = useState<
    { key: 'added' } | { key: 'removed'; index: number } | { key: 'stepAdded' } | { key: 'stepRemoved'; step: number } | { key: 'stepMoved'; from: number; to: number } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setError(null);
    if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [draft]);
  let form: FunnelFormDraft;
  try { form = readFunnelForm(draft); } catch {
    return <section className="schema-funnel-form" aria-labelledby="schema-funnel-heading">
      <h3 id="schema-funnel-heading" tabIndex={-1}>{t('settings:editFunnelSteps')}</h3>
      <p className="notice">{t('settings:funnelFormUnavailable')}</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>{t('settings:openJsonEditor')}</button>
    </section>;
  }
  const funnels = form.funnels ?? [], events = funnelEventChoices(form), errorTarget = issue ? funnelIssueTarget(draft, issue) : null;
  function change(action: FunnelChange) {
    if (!editable) return;
    try {
      const next = changeFunnelForm(draft, action);
      pendingFocus.current = funnelFocusAfterChange(action, funnels.length, 'index' in action ? funnels[action.index]?.steps.length : 0);
      if (action.kind === 'add') setNotice({ key: 'added' });
      if (action.kind === 'remove') setNotice({ key: 'removed', index: action.index + 1 });
      if (action.kind === 'add-step') setNotice({ key: 'stepAdded' });
      if (action.kind === 'remove-step') setNotice({ key: 'stepRemoved', step: action.step + 1 });
      if (action.kind === 'move-step') setNotice({ key: 'stepMoved', from: action.step + 1, to: action.step + action.direction + 1 });
      onChange(next);
    } catch (e) { pendingFocus.current = null; setError(e instanceof Error ? { message: e.message } : { local: true }); }
  }
  return <section className="schema-funnel-form" aria-labelledby="schema-funnel-heading">
    <div className="settings-head"><h3 id="schema-funnel-heading" tabIndex={-1}>{t('settings:editFunnelSteps')}</h3><span className="settings-badge">{funnels.length} / 10</span></div>
    <p className="field-help" id="schema-funnel-help">{t('settings:funnelFormHelp')}</p>
    <p className="field-help">{t('settings:funnelWindowHelp')}</p>
    {funnels.length === 0 && <p className="notice">{t('settings:noFunnels')}</p>}
    <div className="schema-funnel-list">{funnels.map((funnel, index) => {
      const base = `schema-funnel-${index}`, warnings = funnelWarnings(form, index), dimensions = funnelDimensionChoices(form, index);
      const dimensionWarning = warnings.filter(w => w.field === 'dimensions').map(w => messageText(w.message)).join(' ');
      const described = (id: string, extra: string[] = []) => ['schema-funnel-help', ...extra, ...(errorTarget === id ? ['schema-errors'] : [])].join(' ');
      return <fieldset className="schema-funnel-row" key={index}>
        <legend>{t('settings:funnelNumber', { index: index + 1 })}</legend>
        <div className="schema-funnel-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-id`}>{t('settings:funnelId')}</label>
            <input className="text-input" id={`${base}-id`} value={funnel.id} maxLength={48} autoComplete="off" spellCheck={false} readOnly={!editable}
              placeholder="file_conversion" aria-describedby={described(`${base}-id`, [`${base}-id-help`])} aria-invalid={errorTarget === `${base}-id` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'id', value: e.target.value })} />
            <p className="field-help" id={`${base}-id-help`}>{t('settings:workflowIdHelp')}</p></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-label`}>{t('settings:displayName')}</label>
            <input className="text-input" id={`${base}-label`} value={funnel.label} maxLength={80} autoComplete="off" readOnly={!editable}
              placeholder={t('settings:funnelLabelPlaceholder')} aria-describedby={described(`${base}-label`)} aria-invalid={errorTarget === `${base}-label` || undefined}
              onChange={e => change({ kind: 'edit', index, field: 'label', value: e.target.value })} /></div>
        </div>
        <ol className="schema-funnel-steps">{funnel.steps.map((step, stepIndex) => {
          const id = `${base}-step-${stepIndex}-event`, warning = warnings.filter(w => w.field === 'steps' && w.step === stepIndex).map(w => messageText(w.message)).join(' ');
          const value = `${step.source}:${step.eventName}`, missing = step.eventName !== '' && !events.some(e => e.name === step.eventName && e.source === step.source);
          return <li className="schema-funnel-step" key={stepIndex}>
            <div className="settings-field"><label className="field-label" htmlFor={id}>{t('settings:funnelStepLabel', { step: stepIndex + 1, role: stepIndex === 0 ? t('settings:stepStart') : stepIndex === funnel.steps.length - 1 ? t('settings:stepEnd') : t('settings:stepMiddle') })}</label>
              <select className="text-input settings-select" id={id} value={step.eventName === '' ? '' : value} disabled={!editable}
                aria-describedby={described(id, warning ? [`${id}-warning`] : [])} aria-invalid={errorTarget === id || undefined}
                onChange={e => { const selected = events.find(event => `${event.source}:${event.name}` === e.target.value);
                  if (selected) change({ kind: 'event', index, step: stepIndex, eventName: selected.name, source: selected.source }); }}>
                <option value="" disabled>{t('settings:chooseRegisteredEvent')}</option>
                {(['browser', 'server'] as const).map(source => <optgroup key={source} label={source === 'browser' ? t('settings:browserEvents') : t('settings:serverEvents')}>
                  {events.filter(e => e.source === source).map(e => <option key={`${source}:${e.name}`} value={`${source}:${e.name}`}>
                    {e.label.trim() && e.label !== e.name ? `${e.label} (${e.name})` : e.name} · {source === 'browser' ? t('settings:browser') : t('settings:server')}
                  </option>)}
                </optgroup>)}
                {missing && <option value={value}>{step.eventName} · {step.source} ({t('settings:unusable')})</option>}
              </select>
              {warning && <p className="schema-funnel-warning" id={`${id}-warning`}>{warning}</p>}
            </div>
            <div className="schema-funnel-step-actions">
              <button className="secondary-button" type="button" disabled={!editable || stepIndex === 0}
                aria-label={t('settings:moveStepUpLabel', { funnel: index + 1, step: stepIndex + 1 })} onClick={() => change({ kind: 'move-step', index, step: stepIndex, direction: -1 })}>{t('settings:moveUp')}</button>
              <button className="secondary-button" type="button" disabled={!editable || stepIndex === funnel.steps.length - 1}
                aria-label={t('settings:moveStepDownLabel', { funnel: index + 1, step: stepIndex + 1 })} onClick={() => change({ kind: 'move-step', index, step: stepIndex, direction: 1 })}>{t('settings:moveDown')}</button>
              <button className="secondary-button" type="button" disabled={!editable || funnel.steps.length <= 2}
                aria-label={t('settings:removeStepLabel', { funnel: index + 1, step: stepIndex + 1 })} onClick={() => change({ kind: 'remove-step', index, step: stepIndex })}>{t('settings:removeStep')}</button>
            </div>
          </li>;
        })}</ol>
        <button className="secondary-button" type="button" id={`${base}-add-step`} disabled={!editable || funnel.steps.length >= 10}
          onClick={() => change({ kind: 'add-step', index })}>{t('settings:addStep')}</button>
        {warnings.filter(w => w.field === 'steps' && w.step === undefined).map((w, i) => <p className="schema-funnel-warning" key={i}>{messageText(w.message)}</p>)}
        <div className="settings-field schema-funnel-dimension-field">
          <span className="field-label" id={`${base}-dimensions-label`}>{t('settings:dimensionProperties')}</span>
          <div className="schema-funnel-dimensions" role="group" id={`${base}-dimensions`} tabIndex={-1} aria-labelledby={`${base}-dimensions-label`}
            aria-describedby={described(`${base}-dimensions`, [`${base}-dimensions-help`, ...(dimensionWarning ? [`${base}-dimensions-warning`] : [])])}
            aria-invalid={errorTarget === `${base}-dimensions` || undefined}>
            {dimensions.length === 0 ? <p className="field-help">{t('settings:noFunnelDimensions')}</p> : dimensions.map(key => {
              const checked = funnel.dimensions.includes(key);
              return <label className="schema-funnel-dimension" key={key}><input type="checkbox" checked={checked} disabled={!editable || (!checked && funnel.dimensions.length >= 4)}
                onChange={e => change({ kind: 'dimensions', index, value: e.target.checked ? [...funnel.dimensions, key] : funnel.dimensions.filter(d => d !== key) })} />{key}</label>;
            })}
          </div>
          <p className="field-help" id={`${base}-dimensions-help`}>{t('settings:funnelDimensionHelp')}</p>
          {dimensionWarning && <p className="schema-funnel-warning" id={`${base}-dimensions-warning`}>{dimensionWarning}</p>}
        </div>
        <button className="secondary-button" type="button" disabled={!editable} aria-label={t('settings:removeFunnelLabel', { index: index + 1 })} onClick={() => change({ kind: 'remove', index })}>{t('settings:removeFunnel')}</button>
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{'message' in error ? messageText(error.message) : t('settings:funnelUpdateFailed')}</p>}
    <button className="secondary-button" type="button" id="schema-funnel-add" disabled={!editable || funnels.length >= 10} onClick={() => change({ kind: 'add' })}>{t('settings:addFunnel')}</button>
    <p className="field-help">{t('settings:warningsReferenceOnly')}</p>
    <p className="schema-funnel-notice" role="status">{notice ? notice.key === 'added' ? t('settings:funnelAdded')
      : notice.key === 'removed' ? t('settings:funnelRemoved', { index: notice.index })
      : notice.key === 'stepAdded' ? t('settings:funnelStepAdded')
      : notice.key === 'stepRemoved' ? t('settings:funnelStepRemoved', { step: notice.step })
      : t('settings:funnelStepMoved', { from: notice.from, to: notice.to }) : ''}</p>
  </section>;
}
