import { useEffect, useRef, useState } from 'react';
import { changeWorkflowForm, readWorkflowForm, workflowDimensionChoices, workflowFailureReasonChoices, workflowFocusAfterChange, workflowIssueTarget, workflowWarnings } from './api/schema-workflow-form.ts';
import type { WorkflowChange, WorkflowFormDraft, WorkflowPhase } from './api/schema-workflow-form.ts';
import type { SchemaValidation } from './api/schema-contract.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

const PHASES: WorkflowPhase[] = ['startEvent', 'successEvent', 'failureEvent'];
const PHASE_LABEL = { startEvent: 'phaseStart', successEvent: 'phaseSuccess', failureEvent: 'phaseFailure' } as const satisfies Record<WorkflowPhase, string>;
const PHASE_PLACEHOLDER = { startEvent: 'chooseBrowserEvent', successEvent: 'chooseBrowserEvent', failureEvent: 'chooseFailureEvent' } as const satisfies Record<WorkflowPhase, string>;
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
/** Null failure cannot be an option value, so it maps to a sentinel that no valid event name can match. */
const NO_FAILURE = '@none';

export default function SchemaWorkflowForm({ draft, editable, onChange, onOpenJson, issue }: {
  draft: string; editable: boolean; onChange: (next: string) => void; onOpenJson: () => void; issue?: SchemaValidation['issues'][number];
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [error, setError] = useState<{ message: string } | { local: true } | null>(null), [notice, setNotice] = useState<
    { key: 'added' } | { key: 'removed'; index: number } | { key: 'representativeRemoved' } | { key: 'representativeSet' } | { key: 'representativeCleared' } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    setError(null);
    if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [draft]);
  let form: WorkflowFormDraft;
  try { form = readWorkflowForm(draft); } catch {
    return <section className="schema-workflow-form" aria-labelledby="schema-workflow-heading">
      <h3 id="schema-workflow-heading" tabIndex={-1}>{t('settings:editWorkflows')}</h3>
      <p className="notice">{t('settings:workflowFormUnavailable')}</p>
      <button className="secondary-button" type="button" onClick={onOpenJson}>{t('settings:openJsonEditor')}</button>
    </section>;
  }
  const errorTarget = issue ? workflowIssueTarget(draft, issue) : null;
  function change(action: WorkflowChange) {
    if (!editable) return;
    try {
      const next = changeWorkflowForm(draft, action);
      if (action.kind === 'add') { pendingFocus.current = workflowFocusAfterChange(action, form.workflows.length); setNotice({ key: 'added' }); }
      else if (action.kind === 'remove') { pendingFocus.current = workflowFocusAfterChange(action, form.workflows.length);
        setNotice(Object.hasOwn(form, 'representativeWorkflowId') && !Object.hasOwn(JSON.parse(next), 'representativeWorkflowId')
          ? { key: 'representativeRemoved' } : { key: 'removed', index: action.index + 1 }); }
      else if (action.kind === 'representative') setNotice({ key: action.value ? 'representativeSet' : 'representativeCleared' });
      onChange(next);
    } catch (e) {
      pendingFocus.current = null;
      setError(e instanceof Error ? { message: e.message } : { local: true });
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
  const noticeText = !notice ? '' : notice.key === 'added' ? t('settings:workflowAdded')
    : notice.key === 'removed' ? t('settings:workflowRemoved', { index: notice.index })
    : notice.key === 'representativeRemoved' ? t('settings:representativeRemoved')
    : notice.key === 'representativeSet' ? t('settings:representativeSet')
    : t('settings:representativeCleared');
  return <section className="schema-workflow-form" aria-labelledby="schema-workflow-heading">
    <div className="settings-head"><h3 id="schema-workflow-heading" tabIndex={-1}>{t('settings:editWorkflows')}</h3><span className="settings-badge">{form.workflows.length} / 10</span></div>
    <p className="field-help" id="schema-workflow-help">{t('settings:workflowFormHelp')}</p>
    <div className="settings-field"><label className="field-label" htmlFor="schema-representative-workflow">{t('settings:representativeWorkflow')}</label>
      <select className="text-input settings-select" id="schema-representative-workflow" value={representative} disabled={!editable}
        aria-invalid={invalidRepresentative || errorTarget === 'schema-representative-workflow' || undefined}
        aria-describedby={`schema-representative-help${invalidRepresentative ? ' schema-representative-warning' : ''}${errorTarget === 'schema-representative-workflow' ? ' schema-errors' : ''}`}
        onChange={event => change({ kind: 'representative', value: event.target.value })}>
        <option value="">{t('settings:noRepresentativeWorkflow')}</option>
        {representatives.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.label.trim() ? `${workflow.label} (${workflow.id})` : workflow.id}</option>)}
        {invalidRepresentative && representative !== '' && <option value={representative}>{representative} ({t('settings:unusable')})</option>}
      </select>
      <p className="field-help" id="schema-representative-help">{t('settings:representativeWorkflowHelp')}</p>
      {invalidRepresentative && <p className="schema-workflow-warning" id="schema-representative-warning">{t('settings:representativeWorkflowWarning')}</p>}
    </div>
    {form.workflows.length === 0 && <p className="notice">{t('settings:noWorkflows')}</p>}
    <div className="schema-workflow-list">{form.workflows.map((workflow, index) => {
      const base = `schema-workflow-${index}`, choices = workflowDimensionChoices(form, index), atMax = workflow.dimensions.length >= 4;
      /** A raw failure string equal to the sentinel would otherwise render as "no failure", so shift the sentinel for that row. */
      const noFailure = workflow.failureEvent === NO_FAILURE ? '@none-alt' : NO_FAILURE;
      const warnings = workflowWarnings(form, index), dimensionWarning = warnings.filter(item => item.field === 'dimensions').map(item => messageText(item.message)).join(' ');
      const reasonChoices = workflowFailureReasonChoices(form, index), reason = workflow.failureReasonProperty ?? '';
      const reasonInvalid = Object.hasOwn(workflow, 'failureReasonProperty') && !reasonChoices.includes(reason);
      const described = (id: string, extra: string[] = []) => ['schema-workflow-help', `${base}-help`, ...extra, ...(errorTarget === id ? ['schema-errors'] : [])].join(' ');
      return <fieldset className="schema-workflow-row" key={index}>
        <legend>{t('settings:workflowNumber', { index: index + 1 })}</legend>
        <div className="schema-workflow-fields">
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-id`}>{t('settings:workflowId')}</label>
            <input className="text-input" id={`${base}-id`} value={workflow.id} maxLength={48} autoComplete="off" spellCheck={false} readOnly={!editable}
              placeholder="checkout_flow" aria-describedby={described(`${base}-id`, [`${base}-id-help`])} aria-invalid={errorTarget === `${base}-id` || undefined}
              onChange={event => change({ kind: 'edit', index, field: 'id', value: event.target.value })} />
            <p className="field-help" id={`${base}-id-help`}>{t('settings:workflowIdHelp')}</p></div>
          <div className="settings-field"><label className="field-label" htmlFor={`${base}-label`}>{t('settings:displayName')}</label>
            <input className="text-input" id={`${base}-label`} value={workflow.label} maxLength={80} autoComplete="off" readOnly={!editable}
              placeholder={t('settings:workflowLabelPlaceholder')} aria-describedby={described(`${base}-label`, [`${base}-label-help`])} aria-invalid={errorTarget === `${base}-label` || undefined}
              onChange={event => change({ kind: 'edit', index, field: 'label', value: event.target.value })} />
            <p className="field-help" id={`${base}-label-help`}>{t('settings:displayNameHelp')}</p></div>
        </div>
        <div className="schema-workflow-phases">{PHASES.map(phase => {
          const id = `${base}-${phase}`, value = workflow[phase], sentinel = phase === 'failureEvent' ? noFailure : NO_FAILURE;
          const warning = warnings.filter(item => item.field === phase).map(item => messageText(item.message)).join(' ');
          const missing = typeof value === 'string' && value !== '' && !browserEvents.some(event => event.name === value) ? value : null;
          return <div className="settings-field" key={phase}><label className="field-label" htmlFor={id}>{t(`settings:${PHASE_LABEL[phase]}`)}</label>
            <select className="text-input settings-select" id={id} value={value === null ? sentinel : value} disabled={!editable}
              aria-describedby={described(id, warning ? [`${id}-warning`] : [])} aria-invalid={errorTarget === id || undefined}
              onChange={event => change({ kind: 'edit', index, field: phase, value: phase === 'failureEvent' && event.target.value === sentinel ? null : event.target.value })}>
              <option value="">{t(`settings:${PHASE_PLACEHOLDER[phase]}`)}</option>
              {phase === 'failureEvent' && <option value={sentinel}>{t('settings:noFailureStep')}</option>}
              {browserEvents.map(event => <option key={event.name} value={event.name}>{event.label.trim() ? `${event.label} (${event.name})` : event.name}</option>)}
              {missing !== null && <option value={missing}>{missing} ({t('settings:unusable')})</option>}
            </select>
            {warning && <p className="schema-workflow-warning" id={`${id}-warning`}>{warning}</p>}</div>;
        })}</div>
        <div className="settings-field"><label className="field-label" htmlFor={`${base}-failureReasonProperty`}>{t('settings:failureReasonProperty')}</label>
          <select className="text-input settings-select" id={`${base}-failureReasonProperty`} value={reason} disabled={!editable}
            aria-invalid={reasonInvalid || errorTarget === `${base}-failureReasonProperty` || undefined}
            aria-describedby={described(`${base}-failureReasonProperty`, [`${base}-reason-help`, ...(reasonInvalid ? [`${base}-reason-warning`] : [])])}
            onChange={event => change({ kind: 'failureReason', index, value: event.target.value })}>
            <option value="">{t('settings:noFailureReasonTracking')}</option>
            {reasonChoices.map(name => <option key={name} value={name}>{name}</option>)}
            {reasonInvalid && reason !== '' && <option value={reason}>{reason} ({t('settings:unusable')})</option>}
          </select>
          <p className="field-help" id={`${base}-reason-help`}>{t('settings:failureReasonHelp')}</p>
          {reasonInvalid && <p className="schema-workflow-warning" id={`${base}-reason-warning`}>{t('settings:failureReasonWarning')}</p>}
        </div>
        <div className="settings-field schema-workflow-dimension-field">
          <span className="field-label" id={`${base}-dimensions-label`}>{t('settings:dimensionProperties')}</span>
          <div className="schema-workflow-dimensions" id={`${base}-dimensions`} role="group" tabIndex={-1} aria-labelledby={`${base}-dimensions-label`}
            aria-describedby={described(`${base}-dimensions`, [`${base}-dimensions-help`, ...(dimensionWarning ? [`${base}-dimensions-warning`] : [])])}
            aria-invalid={errorTarget === `${base}-dimensions` || undefined}>
            {choices.length === 0 ? <p className="field-help">{t('settings:noDimensionChoices')}</p>
              : choices.map(key => {
                const checked = workflow.dimensions.includes(key);
                return <label className="schema-workflow-dimension" key={key}>
                  <input type="checkbox" checked={checked} disabled={!editable || (!checked && atMax)}
                    onChange={event => change({ kind: 'dimensions', index, value: event.target.checked ? [...workflow.dimensions, key] : workflow.dimensions.filter(item => item !== key) })} />
                  <span className="schema-workflow-dimension-name">{key}</span></label>;
              })}
          </div>
          <p className="field-help" id={`${base}-dimensions-help`}>{t('settings:dimensionHelp')}</p>
          {dimensionWarning && <p className="schema-workflow-warning" id={`${base}-dimensions-warning`}>{dimensionWarning}</p>}
        </div>
        <div className="schema-event-footer"><p className="field-help" id={`${base}-help`}>{t('settings:dimensionCount', { count: workflow.dimensions.length })}</p>
          <button className="secondary-button" type="button" aria-label={t('settings:removeWorkflowLabel', { index: index + 1 })} disabled={!editable} onClick={() => change({ kind: 'remove', index })}>{t('settings:remove')}</button></div>
      </fieldset>;
    })}</div>
    {error && <p className="form-error" role="alert">{'message' in error ? messageText(error.message) : t('settings:workflowUpdateFailed')}</p>}
    <div className="form-actions"><button className="secondary-button" type="button" id="schema-workflow-add" disabled={!editable || form.workflows.length >= 10} onClick={() => change({ kind: 'add' })}>{t('settings:addWorkflow')}</button>
      {form.workflows.length >= 10 && <p className="field-help">{t('settings:workflowLimitReached')}</p>}</div>
    <p className="schema-workflow-notice" role="status">{noticeText}</p>
  </section>;
}
