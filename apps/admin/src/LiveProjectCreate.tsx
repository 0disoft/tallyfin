import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ApiClient } from './api/client.ts';
import type { ProjectSettings } from './api/types.ts';
import { ProjectCreator } from './api/project-creator.ts';
import type { CreatorState } from './api/project-creator.ts';
import type { CreationDraft } from './api/project-creation.ts';
import type { DraftExitRegistration } from './api/draft-exit-guard.ts';
import useUnloadWarning from './useUnloadWarning.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

const fields: { key: keyof CreationDraft; placeholder?: string; max?: number }[] = [
  { key: 'name', max: 80 },
  { key: 'id', placeholder: 'my-service', max: 48 },
  { key: 'timeZone', placeholder: 'Asia/Seoul', max: 64 },
  { key: 'origins', placeholder: 'https://my-service.com' },
  { key: 'requestsPerMinute' },
  { key: 'newReceiptsPerUtcDay' },
];
export default function LiveProjectCreate({ client, onCreated, onClose, registerDraft }: { client: ApiClient; onCreated: (settings: ProjectSettings) => boolean | void; onClose: () => void; registerDraft?: DraftExitRegistration<ApiClient> }) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [state, setState] = useState<CreatorState | null>(null), [limitsOpen, setLimitsOpen] = useState(false);
  const creator = useRef<ProjectCreator | null>(null), heading = useRef<HTMLHeadingElement>(null);
  useUnloadWarning(Boolean(creator.current?.hasUnsavedChanges));
  const opened = useRef(onCreated);
  opened.current = onCreated;
  useEffect(() => {
    const controller = new ProjectCreator(client, settings => opened.current(settings)); creator.current = controller;
    const removeExitCheck = registerDraft?.(client, null, () => controller.hasUnsavedChanges);
    const unsubscribe = controller.subscribe(setState);
    return () => { unsubscribe(); controller.destroy(); removeExitCheck?.(); if (creator.current === controller) creator.current = null; };
  }, [client, registerDraft]);
  const errorKey = fields.find(f => state?.errors[f.key])?.key;
  useEffect(() => { if (errorKey === 'requestsPerMinute' || errorKey === 'newReceiptsPerUtcDay') setLimitsOpen(true); }, [errorKey]);
  useEffect(() => { if (errorKey) document.getElementById(`create-${errorKey}`)?.focus(); }, [state?.errors, errorKey, limitsOpen]);
  useEffect(() => { heading.current?.focus(); }, [Boolean(state)]);
  if (!state) return null;
  const fieldLabel = (key: keyof CreationDraft) => {
    switch (key) {
      case 'name': return t('operations:createName');
      case 'id': return t('operations:createId');
      case 'timeZone': return t('operations:createTimeZone');
      case 'origins': return t('operations:createOrigins');
      case 'requestsPerMinute': return t('operations:createRequestsPerMinute');
      case 'newReceiptsPerUtcDay': return t('operations:createDailyLimit');
      default: return key;
    }
  };
  const fieldHelp = (key: keyof CreationDraft) => {
    switch (key) {
      case 'name': return t('operations:createNameHelp');
      case 'id': return t('operations:createIdHelp');
      case 'timeZone': return t('operations:createTimeZoneHelp');
      case 'origins': return t('operations:createOriginsHelp');
      case 'requestsPerMinute': return t('operations:createRequestsPerMinuteHelp');
      case 'newReceiptsPerUtcDay': return t('operations:createDailyLimitHelp');
      default: return '';
    }
  };
  const locked = state.phase !== 'ready', busy = state.phase === 'creating' || state.phase === 'opening';
  const renderField = (field: typeof fields[number]) => {
    const id = `create-${field.key}`, error = state.errors[field.key];
    const props = { id, className: 'text-input', value: state.draft[field.key], disabled: locked, autoComplete: 'off',
      'aria-invalid': error ? true : undefined, 'aria-describedby': `${id}-help${error ? ` ${id}-error` : ''}`,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => creator.current?.edit(field.key, event.target.value) };
    const placeholder = field.key === 'name' ? t('operations:createNamePlaceholder')
      : field.key === 'origins' ? t('operations:createOriginsPlaceholder') : field.placeholder;
    return <div className={`settings-field${field.key === 'origins' ? 'project-create-wide' : ''}`} key={field.key}>
      <label className="field-label" htmlFor={id}>{fieldLabel(field.key)}</label>
      {field.key === 'origins' ? <textarea {...props} rows={3} className="text-input settings-textarea" placeholder={placeholder} />
        : <input {...props} maxLength={field.max} placeholder={placeholder} inputMode={field.key.endsWith('Minute') || field.key.endsWith('Day') ? 'numeric' : 'text'} />}
      <p className="field-help" id={`${id}-help`}>{fieldHelp(field.key)}</p>
      {error && <p className="form-error" id={`${id}-error`} role="alert">{messageText(error)}</p>}
    </div>;
  };
  return <section className="settings-section project-create" aria-labelledby="project-create-heading" aria-busy={busy || undefined}>
    <div className="settings-head"><h2 id="project-create-heading" tabIndex={-1} ref={heading}>{t('operations:createHeading')}</h2></div>
    <ol className="setup-steps" aria-label={t('operations:createStepsLabel')}><li aria-current="step">{t('operations:createStepProject')}</li><li>{t('operations:createStepSchema')}</li><li>{t('operations:createStepSdk')}</li></ol>
    <p className="context-note">{t('operations:createIntro')}</p>
    {state.message && <p className="notice" role="status">{messageText(state.message)}</p>}
    <form onSubmit={event => { event.preventDefault(); void creator.current?.create(); }} noValidate>
      <div className="project-create-grid">{fields.slice(0, 4).map(renderField)}</div>
      <details className="project-create-limits" open={limitsOpen} onToggle={event => setLimitsOpen(event.currentTarget.open)}>
        <summary>{t('operations:createLimitsSummary', { requestsPerMinute: state.draft.requestsPerMinute || '—', newReceiptsPerUtcDay: state.draft.newReceiptsPerUtcDay || '—' })}</summary>
        <div className="project-create-grid">{fields.slice(4).map(renderField)}</div>
      </details>
      {state.phase === 'uncertain' ? <div className="settings-recovery">
        <p>{t('operations:createUncertain')}</p>
        <button className="primary-button" type="button" onClick={() => { void creator.current?.confirm(); }}>{t('operations:createConfirmSame')}</button>
        <p className="field-help">{t('operations:createConfirmHelp')}</p>
      </div> : <div className="form-actions">
        {state.receipt ? <button className="primary-button" type="button" disabled={busy} onClick={() => { void creator.current?.open(); }}>{busy ? t('operations:createOpening') : t('operations:createOpenCreated')}</button>
          : <button className="primary-button" type="submit" disabled={locked}>{busy ? t('operations:createSubmitting') : t('operations:createSubmit')}</button>}
        <button className="secondary-button" type="button" disabled={busy} onClick={() => {
          if (!creator.current?.hasUnsavedChanges || window.confirm(t('operations:createDiscardConfirm'))) onClose();
        }}>{t('operations:closeButton')}</button>
      </div>}
    </form>
  </section>;
}
