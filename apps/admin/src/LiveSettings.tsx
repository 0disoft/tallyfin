// Live project settings editor for the API-connected admin console.
// This component owns no server state. The parent-provided SettingsEditor
// controller holds the snapshot, draft, phase and errors; this file renders
// that state, forwards edits, and keeps the draft visible when a save hits a
// conflict or a lost response so the user can compare and choose.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import type { ApiClient } from './api/client.ts';
import type { ProjectSettings, Registry } from './api/types.ts';
import { SettingsEditor, settingsDraft, type SettingsDraft, type SettingsState, type SettingsSnapshot } from './api/settings-editor.ts';
import LiveGrants from './LiveGrants.tsx';
import LivePublishers from './LivePublishers.tsx';
import LiveAdminChanges from './LiveAdminChanges.tsx';
import HelpTerm from './HelpTerm';
import useUnloadWarning from './useUnloadWarning.ts';
import type { DraftExitRegistration } from './api/draft-exit-guard.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';
import './settings-project.css';

export type LiveSettingsProps = {
  client: ApiClient;
  projectId: string;
  onSaved: (settings: ProjectSettings) => void;
  refreshTick: number;
  registry?: Registry | null;
  onAccessLost?: () => void;
  registerDraft?: DraftExitRegistration<ApiClient>;
  panel?: 'project' | 'access';
};

const FIELD_ORDER: (keyof SettingsDraft)[] = ['name', 'status', 'origins', 'requestsPerMinute', 'newReceiptsPerUtcDay'];

const FIELD_ID: Record<keyof SettingsDraft, string> = {
  name: 'settings-name',
  status: 'settings-status',
  origins: 'settings-origins',
  requestsPerMinute: 'settings-requests-per-minute',
  newReceiptsPerUtcDay: 'settings-new-receipts-per-utc-day',
};

const READONLY_FIELD_ID = { projectId: 'settings-project-id', timeZone: 'settings-project-time-zone' } as const;

const STATUS_LABEL = { active: 'statusActive', paused: 'statusPaused' } as const;

function firstErrorKey(errors: SettingsState['errors'] | null | undefined): keyof SettingsDraft | null {
  if (!errors) return null;
  return FIELD_ORDER.find(key => Boolean(errors[key])) ?? null;
}

function describedBy(key: keyof SettingsDraft, errors: SettingsState['errors'] | null, help: boolean): string | undefined {
  const ids = [
    help ? `${FIELD_ID[key]}-help` : null,
    errors?.[key] ? `${FIELD_ID[key]}-error` : null,
  ].filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function displayValue(value: string): string {
  return value.length > 0 ? value : '—';
}

export function LiveSettings({ client, projectId, onSaved, refreshTick, registry = null, onAccessLost, registerDraft, panel = 'project' }: LiveSettingsProps) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [snapshotState, setSnapshotState] = useState<{ client: ApiClient; projectId: string; state: SettingsState } | null>(null);
  const state = snapshotState?.client === client && snapshotState.projectId === projectId ? snapshotState.state : null;
  const editorRef = useRef<SettingsEditor | null>(null);
  useUnloadWarning(Boolean(editorRef.current?.hasUnsavedChanges));
  const activeScope = useRef({ client, projectId });
  activeScope.current = { client, projectId };
  const accessCallbackRef = useRef(onAccessLost); accessCallbackRef.current = onAccessLost;
  const [grantLoss, setGrantLoss] = useState<{ client: ApiClient; projectId: string; snapshot: SettingsSnapshot | null } | null>(null);
  const [publisherBusy, setPublisherBusy] = useState<{ client: ApiClient; projectId: string } | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const settingsSaved = useCallback((settings: ProjectSettings) => {
    if (activeScope.current.client !== client || activeScope.current.projectId !== projectId) return;
    setHistoryRevision(value => value + 1); onSaved(settings);
  }, [client, projectId, onSaved]);
  const grantsSaved = useCallback(() => {
    if (activeScope.current.client === client && activeScope.current.projectId === projectId) setHistoryRevision(value => value + 1);
  }, [client, projectId]);
  const publishersSaved = useCallback(() => {
    if (activeScope.current.client === client && activeScope.current.projectId === projectId) setHistoryRevision(value => value + 1);
  }, [client, projectId]);
  // A publisher write locks the settings form and the grant editor until it
  // resolves; the publisher section itself keeps its own review confirmable.
  const publisherBusyChange = useCallback((busy: boolean) => setPublisherBusy(busy ? { client, projectId } : null), [client, projectId]);
  const tickRef = useRef(refreshTick);
  const lastErrorRef = useRef<keyof SettingsDraft | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLInputElement>(null);
  const originsRef = useRef<HTMLTextAreaElement>(null);
  const requestsPerMinuteRef = useRef<HTMLInputElement>(null);
  const newReceiptsRef = useRef<HTMLInputElement>(null);
  const inputRefs: Record<keyof SettingsDraft, RefObject<HTMLElement | null>> = {
    name: nameRef,
    status: statusRef,
    origins: originsRef,
    requestsPerMinute: requestsPerMinuteRef,
    newReceiptsPerUtcDay: newReceiptsRef,
  };

  // Rebuild the controller on mount and whenever the client or project
  // changes. StrictMode cleanup/replay creates and disposes it cleanly.
  useEffect(() => {
    const editor = new SettingsEditor(client, projectId, settingsSaved, () => {
      if (activeScope.current.client === client && activeScope.current.projectId === projectId) accessCallbackRef.current?.();
    });
    editorRef.current = editor;
    const removeExitCheck = registerDraft?.(client, projectId, () => editor.hasUnsavedChanges);
    const unsubscribe = editor.subscribe(state => setSnapshotState({ client, projectId, state }));
    void editor.load();
    return () => {
      unsubscribe();
      editor.destroy();
      removeExitCheck?.();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [client, projectId, settingsSaved, registerDraft]);

  // A refreshTick bump re-reads the settings. The first render is skipped so
  // mounting does not fire a second request on top of load().
  useEffect(() => {
    if (tickRef.current === refreshTick) return;
    tickRef.current = refreshTick;
    void editorRef.current?.refresh();
  }, [refreshTick]);

  const errorKey = firstErrorKey(state?.errors);
  useEffect(() => {
    if (errorKey && errorKey !== lastErrorRef.current) inputRefs[errorKey].current?.focus();
    lastErrorRef.current = errorKey;
  });

  const phase = state?.phase ?? 'loading';
  const snapshot = state?.snapshot ?? null;
  const draft = state?.draft ?? null;
  const errors = state?.errors ?? null;
  const blocked = Boolean(state?.blocked);
  const saving = phase === 'saving';
  const loading = phase === 'loading';
  const reviewing = phase === 'review';
  const loaded = Boolean(snapshot && draft);
  // Read/write follows the server grant; a reader stays read-only.
  const lost = grantLoss?.client === client && grantLoss.projectId === projectId;
  const publishersBusy = publisherBusy?.client === client && publisherBusy.projectId === projectId;
  const freshOwner = phase === 'ready' && snapshot?.canEdit === true && snapshot !== grantLoss?.snapshot;
  const canEdit = snapshot?.canEdit === true && state?.latest?.canEdit !== false && (!lost || freshOwner);
  const accessLost = useCallback(() => {
    if (activeScope.current.client !== client || activeScope.current.projectId !== projectId) return;
    setGrantLoss({ client, projectId, snapshot });
    void editorRef.current?.checkLatest();
    accessCallbackRef.current?.();
  }, [client, projectId, snapshot]);
  useEffect(() => { if (lost && freshOwner) setGrantLoss(null); }, [lost, freshOwner]);
  // Inputs unlock only in the ready phase for an owner with no lock.
  const inputsLocked = phase !== 'ready' || blocked || !canEdit || publishersBusy;
  const canSubmit = loaded && phase === 'ready' && canEdit && !blocked && !publishersBusy;
  // The recovery panel covers a save conflict or a lost response. A pure reader
  // has nothing to recover, so it stays hidden for read-only grants.
  const showRecovery = reviewing || (blocked && canEdit);

  const edit = (key: keyof SettingsDraft, value: string) => editorRef.current?.edit(key, value);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    void editorRef.current?.save();
  };

  if (!state || (!loaded && phase !== 'error')) {
    return <section className="state-panel" role="status" aria-busy="true">
      <h2>{t('settings:loadingTitle')}</h2>
      <p>{t('settings:loadingHelp')}</p>
    </section>;
  }

  if (!loaded) {
    return <section className="state-panel" role="alert">
      <WarningCircle size={32} />
      <h2>{t('settings:loadFailedTitle')}</h2>
      <p>{state.message ? messageText(state.message) : t('settings:loadFailedHelp')}</p>
      <div className="state-actions"><button className="secondary-button" type="button" onClick={() => { void editorRef.current?.load(); }}>{t('settings:retry')}</button></div>
    </section>;
  }

  const activeSnapshot = snapshot as SettingsSnapshot;
  const activeDraft = draft as SettingsDraft;
  const originalDraft = settingsDraft(activeSnapshot);
  const dirtyCount = (Object.keys(originalDraft) as (keyof SettingsDraft)[]).filter(key => originalDraft[key] !== activeDraft[key]).length;

  return <section className="settings-section live-settings" data-panel={panel} aria-labelledby="live-settings-heading">
    <div className="live-settings-head">
      <div className="live-settings-title">
        <h2 id="live-settings-heading">{panel === 'access' ? t('settings:accessTitle') : t('settings:projectSettingsTitle')}</h2>
        <p className="context-note">{panel === 'access' ? t('settings:accessHelp') : t('settings:projectSettingsHelp')}</p>
      </div>
      <div className="live-settings-badges">
        {(saving || loading) && <span className="settings-badge" role="status">{saving ? t('settings:saving') : t('settings:loading')}</span>}
        {!canEdit && <span className="settings-badge is-readonly">{t('settings:readOnly')}</span>}
      </div>
    </div>
    {!canEdit && <p className="notice" role="status">{t('settings:readOnlyNotice')}</p>}
    {state.message && !showRecovery && <p className="settings-message" role="status">{messageText(state.message)}</p>}

    {showRecovery && <section className="settings-recovery" aria-label={t('settings:recoveryLabel')}>
      <p className="settings-recovery-message" role="status">{state.message ? messageText(state.message) : t('settings:recoveryHelp')}</p>
      <button className="secondary-button" type="button" disabled={loading || saving} onClick={() => { void editorRef.current?.checkLatest(); }}>{t('settings:checkLatestSettings')}</button>
      {reviewing && state.latest ? <>
        <ComparisonTable latest={state.latest} draft={activeDraft} />
        <div className="form-actions">
          <button className="primary-button" type="button" onClick={() => editorRef.current?.useServer()}>{t('settings:useServerSettings')}</button>
          <button className="secondary-button" type="button" onClick={() => editorRef.current?.keepChanges()} disabled={!state.latest.canEdit}>{t('settings:keepChangesAndReview')}</button>
        </div>
      </> : null}
    </section>}

    <div className="settings-panel settings-panel-project" hidden={panel !== 'project'}>
      <form className="settings-form project-settings-form" onSubmit={submit} aria-busy={saving || loading || undefined} noValidate>
        <section className="settings-row" aria-labelledby="settings-basic-heading">
          <div className="settings-row-copy">
            <h3 id="settings-basic-heading">{t('settings:basicInfo')}</h3>
            <p>{t('settings:basicInfoHelp')}</p>
          </div>
          <div className="settings-row-fields">
            <div className="settings-field">
              <label className="field-label" htmlFor={FIELD_ID.name}>{t('settings:projectName')}</label>
              <input id={FIELD_ID.name} ref={nameRef} className="text-input" type="text" autoComplete="off" maxLength={80} value={activeDraft.name} disabled={inputsLocked} onChange={event => edit('name', event.target.value)} aria-invalid={errors?.name ? true : undefined} aria-describedby={describedBy('name', errors, true)} />
              <p id={`${FIELD_ID.name}-help`} className="field-help">{t('settings:nameLengthHelp')}</p>
              {errors?.name && <p id={`${FIELD_ID.name}-error`} className="form-error" role="alert">{messageText(errors.name)}</p>}
            </div>

            <div className="settings-field">
              <label className="field-label" htmlFor={READONLY_FIELD_ID.projectId}>{t('settings:projectId')}</label>
              <div className="settings-readonly-row">
                <input id={READONLY_FIELD_ID.projectId} className="text-input settings-readonly" type="text" value={activeSnapshot.project.id} readOnly aria-describedby={`${READONLY_FIELD_ID.projectId}-help`} />
                <span id={`${READONLY_FIELD_ID.projectId}-help`} className="field-help">{t('settings:cannotChange')}</span>
              </div>
            </div>

            <div className="settings-field">
              <span className="field-label" id={`${FIELD_ID.status}-label`}>{t('settings:collectionStatus')}</span>
              <div className="settings-segmented" role="radiogroup" aria-labelledby={`${FIELD_ID.status}-label`} aria-invalid={errors?.status ? true : undefined} aria-describedby={describedBy('status', errors, true)}>
                {(['active', 'paused'] as const).map((value, index) => <label key={value} className={`settings-segment${activeDraft.status === value ? ' is-active' : ''}`}>
                  <input id={index === 0 ? FIELD_ID.status : `${FIELD_ID.status}-paused`} ref={index === 0 ? statusRef : undefined} className="settings-segment-input" type="radio" name={`settings-status-${projectId}`} value={value} checked={activeDraft.status === value} disabled={inputsLocked} onChange={() => edit('status', value)} />
                  <span>{t(`settings:${STATUS_LABEL[value]}`)}</span>
                </label>)}
              </div>
              <p id={`${FIELD_ID.status}-help`} className="field-help">{t('settings:statusHelp')}</p>
              {errors?.status && <p id={`${FIELD_ID.status}-error`} className="form-error" role="alert">{messageText(errors.status)}</p>}
            </div>
          </div>
        </section>

        <section className="settings-row" aria-labelledby="settings-origins-heading">
          <div className="settings-row-copy">
            <h3 id="settings-origins-heading">{t('settings:allowedDomains')}</h3>
            <p>{t('settings:allowedDomainsHelp')}</p>
          </div>
          <div className="settings-row-fields">
            <div className="settings-field">
              <label className="field-label" htmlFor={FIELD_ID.origins}><HelpTerm content={t('analysis:helpAllowedOrigins')}>{t('settings:allowedOrigins')}</HelpTerm></label>
              <textarea id={FIELD_ID.origins} ref={originsRef} className="text-input settings-textarea" rows={5} spellCheck={false} value={activeDraft.origins} disabled={inputsLocked} onChange={event => edit('origins', event.target.value)} aria-invalid={errors?.origins ? true : undefined} aria-describedby={describedBy('origins', errors, true)} />
              <p id={`${FIELD_ID.origins}-help`} className="field-help">{t('settings:originsHelp')}</p>
              {errors?.origins && <p id={`${FIELD_ID.origins}-error`} className="form-error" role="alert">{messageText(errors.origins)}</p>}
            </div>
          </div>
        </section>

        <section className="settings-row" aria-labelledby="settings-limits-heading">
          <div className="settings-row-copy">
            <h3 id="settings-limits-heading">{t('settings:collectionLimits')}</h3>
            <p>{t('settings:collectionLimitsHelp')}</p>
          </div>
          <div className="settings-row-fields settings-limit-fields">
            <div className="settings-field">
              <label className="field-label" htmlFor={FIELD_ID.requestsPerMinute}><HelpTerm content={t('analysis:helpRequestLimit')}>{t('settings:requestsPerMinute')}</HelpTerm></label>
              <input id={FIELD_ID.requestsPerMinute} ref={requestsPerMinuteRef} className="text-input" type="text" inputMode="numeric" pattern="[0-9]*" value={activeDraft.requestsPerMinute} disabled={inputsLocked} onChange={event => edit('requestsPerMinute', event.target.value)} aria-invalid={errors?.requestsPerMinute ? true : undefined} aria-describedby={describedBy('requestsPerMinute', errors, true)} />
              <p id={`${FIELD_ID.requestsPerMinute}-help`} className="field-help">{t('settings:requestsPerMinuteHelp')}</p>
              {errors?.requestsPerMinute && <p id={`${FIELD_ID.requestsPerMinute}-error`} className="form-error" role="alert">{messageText(errors.requestsPerMinute)}</p>}
            </div>

            <div className="settings-field">
              <label className="field-label" htmlFor={FIELD_ID.newReceiptsPerUtcDay}><HelpTerm content={t('analysis:helpDailyReceiptLimit')}>{t('settings:dailyReceiptLimit')}</HelpTerm></label>
              <input id={FIELD_ID.newReceiptsPerUtcDay} ref={newReceiptsRef} className="text-input" type="text" inputMode="numeric" pattern="[0-9]*" value={activeDraft.newReceiptsPerUtcDay} disabled={inputsLocked} onChange={event => edit('newReceiptsPerUtcDay', event.target.value)} aria-invalid={errors?.newReceiptsPerUtcDay ? true : undefined} aria-describedby={describedBy('newReceiptsPerUtcDay', errors, true)} />
              <p id={`${FIELD_ID.newReceiptsPerUtcDay}-help`} className="field-help">{t('settings:dailyReceiptLimitHelp')}</p>
              {errors?.newReceiptsPerUtcDay && <p id={`${FIELD_ID.newReceiptsPerUtcDay}-error`} className="form-error" role="alert">{messageText(errors.newReceiptsPerUtcDay)}</p>}
            </div>
          </div>
        </section>

        <section className="settings-row" aria-labelledby="settings-timezone-heading">
          <div className="settings-row-copy">
            <h3 id="settings-timezone-heading">{t('settings:projectTimezone')}</h3>
            <p>{t('settings:projectTimezoneHelp')}</p>
          </div>
          <div className="settings-row-fields">
            <div className="settings-field">
              <label className="field-label" htmlFor={READONLY_FIELD_ID.timeZone}><HelpTerm content={t('analysis:helpTimeZone')}>{t('settings:projectTimezone')}</HelpTerm></label>
              <input id={READONLY_FIELD_ID.timeZone} className="text-input settings-readonly" type="text" value={activeSnapshot.project.timeZone} readOnly aria-describedby={`${READONLY_FIELD_ID.timeZone}-help`} />
              <p id={`${READONLY_FIELD_ID.timeZone}-help`} className="field-help">{t('settings:timezoneReadOnlyHelp')}</p>
            </div>
          </div>
        </section>

        <details className="settings-registry">
          <summary>
            <span>{t('settings:viewRegisteredDefinitions')}</span>
            {registry && <span className="settings-registry-meta">{t('settings:registryMeta', { version: registry.schemaVersion, status: registry.schemaStatus === 'retired' ? t('settings:retired') : t('settings:active') })}</span>}
          </summary>
          {registry ? <div className="settings-registry-body">
            <h3 className="settings-subheading">{t('settings:registeredEvents')}</h3>
            <div className="table-scroll" tabIndex={0} aria-label={t('settings:registeredEventsTable')}><table className="event-table"><thead><tr><th scope="col">{t('settings:event')}</th><th scope="col">{t('settings:source')}</th><th scope="col">{t('settings:allowedProperties')}</th></tr></thead><tbody>{registry.events.map(definition => <tr key={definition.name}><th scope="row" className="event-name">{definition.name}<div className="event-label">{definition.label}</div></th><td>{definition.source}</td><td>{Object.keys(definition.properties).join(', ') || '—'}</td></tr>)}</tbody></table></div>
            <h3 className="settings-subheading">{t('settings:workflows')}</h3>
            <div className="table-scroll" tabIndex={0} aria-label={t('settings:workflowTable')}><table className="event-table"><thead><tr><th scope="col">{t('settings:workflow')}</th><th scope="col">{t('settings:start')}</th><th scope="col">{t('settings:success')}</th><th scope="col">{t('settings:failure')}</th></tr></thead><tbody>{registry.workflows.length === 0 ? <tr><th scope="row">—</th><td>—</td><td>—</td><td>—</td></tr> : registry.workflows.map(definition => <tr key={definition.id}><th scope="row" className="event-name">{definition.id}<div className="event-label">{definition.label}</div></th><td>{definition.startEvent}</td><td>{definition.successEvent}</td><td>{definition.failureEvent ?? '—'}</td></tr>)}</tbody></table></div>
          </div> : <p className="context-note settings-registry-empty">{t('settings:registryUnavailable')}</p>}
        </details>

        <div className="settings-action-bar">
          <p className={`settings-action-status${dirtyCount > 0 && canEdit ? ' is-dirty' : ''}`} role="status" aria-live="polite">
            <span className={`settings-dirty-dot${dirtyCount > 0 ? ' is-dirty' : ''}`} aria-hidden="true" />
            {saving ? t('settings:saving') : !canEdit ? t('settings:readOnly') : dirtyCount > 0 ? t('settings:dirtyCount', { count: dirtyCount }) : t('settings:noChangesToSave')}
          </p>
          <div className="settings-action-buttons">
            <button className="secondary-button" type="button" disabled={inputsLocked} onClick={() => editorRef.current?.reset()}>{t('settings:resetEdits')}</button>
            <button className="primary-button" type="submit" disabled={!canSubmit}>{saving ? t('settings:saving') : t('settings:saveChanges')}</button>
          </div>
        </div>
      </form>
    </div>

    <div className="settings-panel settings-panel-access" hidden={panel !== 'access'}>
      <LiveGrants client={client} projectId={projectId} timeZone={activeSnapshot.project.timeZone} refreshTick={refreshTick}
        canView={canEdit && !blocked} locked={loading || saving || reviewing || publishersBusy} onAccessLost={accessLost} onSaved={grantsSaved} registerDraft={registerDraft} />

      <LivePublishers client={client} projectId={projectId} timeZone={activeSnapshot.project.timeZone} refreshTick={refreshTick}
        canView={canEdit && !blocked} locked={loading || saving || reviewing} onAccessLost={accessLost} onSaved={publishersSaved}
        onBusyChange={publisherBusyChange} registerDraft={registerDraft} />

      <LiveAdminChanges client={client} projectId={projectId} timeZone={activeSnapshot.project.timeZone}
        refreshTick={`${refreshTick}:${historyRevision}`} canView={canEdit && !blocked}
        locked={loading || saving || reviewing} onAccessLost={accessLost} />
    </div>
  </section>;
}

function ComparisonTable({ latest, draft }: { latest: SettingsSnapshot; draft: SettingsDraft }) {
  const { t } = useI18n();
  const server = settingsDraft(latest);
  const rows: { label: 'compareName' | 'compareStatus' | 'compareOrigins' | 'compareRequestLimit' | 'compareReceiptLimit'; key: keyof SettingsDraft; format: (value: string) => string }[] = [
    { label: 'compareName', key: 'name', format: displayValue },
    { label: 'compareStatus', key: 'status', format: value => STATUS_LABEL[value as 'active' | 'paused'] ? t(`settings:${STATUS_LABEL[value as 'active' | 'paused']}`) : value },
    { label: 'compareOrigins', key: 'origins', format: displayValue },
    { label: 'compareRequestLimit', key: 'requestsPerMinute', format: displayValue },
    { label: 'compareReceiptLimit', key: 'newReceiptsPerUtcDay', format: displayValue },
  ];
  return <div className="table-scroll" tabIndex={0} aria-label={t('settings:comparisonLabel')}>
    <table className="event-table settings-diff">
      <caption className="sr-only">{t('settings:comparisonLabel')}</caption>
      <thead><tr><th scope="col">{t('settings:comparisonItem')}</th><th scope="col">{t('settings:latestServerSettings')}</th><th scope="col">{t('settings:myInput')}</th></tr></thead>
      <tbody>{rows.map(row => {
        const changed = server[row.key] !== draft[row.key];
        return <tr key={row.key} className={changed ? 'changed' : undefined}>
          <th scope="row" className="event-name">{t(`settings:${row.label}`)}{changed && <span className="settings-diff-flag">{t('settings:changed')}</span>}</th>
          <td>{row.format(server[row.key])}</td>
          <td>{row.format(draft[row.key])}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export default LiveSettings;
