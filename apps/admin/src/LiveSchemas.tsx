import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { SchemaEditor } from './api/schema-editor.ts';
import type { SchemaState } from './api/schema-editor.ts';
import { readDraft } from './api/schema-contract.ts';
import type { SchemaIssueCode } from './api/schema-contract.ts';
import SchemaEventForm from './SchemaEventForm.tsx';
import { eventIssueTarget } from './api/schema-event-form.ts';
import { propertyIssueTarget } from './api/schema-property-form.ts';
import SchemaWorkflowForm from './SchemaWorkflowForm.tsx';
import { workflowIssueTarget } from './api/schema-workflow-form.ts';
import SchemaFunnelForm from './SchemaFunnelForm.tsx';
import { funnelIssueTarget } from './api/schema-funnel-form.ts';
import useUnloadWarning from './useUnloadWarning.ts';
import type { DraftExitRegistration } from './api/draft-exit-guard.ts';
import SchemaDraftFiles from './SchemaDraftFiles.tsx';
import SchemaVersionComparison from './SchemaVersionComparison.tsx';
import ServerSchemaDraft from './ServerSchemaDraft.tsx';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';
import './schema-workbench.css';

const ISSUE_TEXT = {
  invalid_definition: 'issueInvalidDefinition', definition_limit: 'issueDefinitionLimit', duplicate: 'issueDuplicate', cardinality_limit: 'issueCardinalityLimit',
  browser_event_required: 'issueBrowserEventRequired', invalid_reference: 'issueInvalidReference',
  dimension_mismatch: 'issueDimensionMismatch',
} as const satisfies Record<SchemaIssueCode, string>;

export default function LiveSchemas({ client, projectId, refreshTick, onVersionChange, onAccessLost, registerDraft }: { client: ApiClient; projectId: string; refreshTick: number; onVersionChange?: (version: number) => void; onAccessLost?: () => void; registerDraft?: DraftExitRegistration<ApiClient> }) {
  const { t, locale } = useI18n();
  const messageText = useMessageText();
  const [state, setState] = useState<SchemaState | null>(null);
  const [editMode, setEditMode] = useState<'json' | 'form'>('json');
  const editorRef = useRef<SchemaEditor | null>(null), inputRef = useRef<HTMLTextAreaElement>(null), tick = useRef(refreshTick);
  useUnloadWarning(Boolean(editorRef.current?.hasUnsavedChanges), () => Boolean(editorRef.current?.hasUnsavedChanges));
  const previousVersion = useRef<number | null | undefined>(undefined);
  const activeScope = useRef({ client, projectId }); activeScope.current = { client, projectId };
  const accessCallbackRef = useRef(onAccessLost); accessCallbackRef.current = onAccessLost;
  const version = state?.phase === 'ready' ? state.snapshot?.page.latestVersion : undefined;
  useEffect(() => {
    if (version === undefined) return;
    if (previousVersion.current !== undefined && version !== null && version !== previousVersion.current) onVersionChange?.(version);
    previousVersion.current = version;
  }, [version, onVersionChange]);
  useEffect(() => {
    const editor = new SchemaEditor(client, projectId, () => {
      if (activeScope.current.client === client && activeScope.current.projectId === projectId) accessCallbackRef.current?.();
    }); editorRef.current = editor;
    const removeExitCheck = registerDraft?.(client, projectId, () => editor.hasUnsavedChanges);
    const unsubscribe = editor.subscribe(setState); void editor.load();
    return () => { unsubscribe(); editor.destroy(); removeExitCheck?.(); if (editorRef.current === editor) editorRef.current = null; };
  }, [client, projectId, registerDraft]);
  useEffect(() => { if (tick.current !== refreshTick) { tick.current = refreshTick; void editorRef.current?.refresh(); } }, [refreshTick]);
  const issue = state?.report?.issues[0];
  // Commit the editor-mode change before the frame that focuses its input.
  useLayoutEffect(() => {
    if (!state?.formError && !issue) return;
    const target = issue && state ? funnelIssueTarget(state.draft, issue) ?? workflowIssueTarget(state.draft, issue) ?? propertyIssueTarget(state.draft, issue) ?? eventIssueTarget(state.draft, issue) : null;
    if (target) { setEditMode('form'); const frame = requestAnimationFrame(() => document.getElementById(target)?.focus()); return () => cancelAnimationFrame(frame); }
    setEditMode('json');
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [state?.formError, issue]);
  if (!state || !state.snapshot) return <section className="settings-section schema-section" aria-busy={!state || state.phase === 'loading'}>
    <h2>{t('settings:schemaTitle')}</h2>
    <p role={state?.phase === 'error' ? 'alert' : 'status'}>{state?.phase === 'error' ? messageText(state.message) : t('settings:schemaLoading')}</p>
    {state?.phase === 'error' && <button className="secondary-button" onClick={() => { void editorRef.current?.load(); }}>{t('settings:reload')}</button>}
  </section>;
  const { snapshot } = state, busy = ['loading', 'validating', 'publishing'].includes(state.phase), owner = !state.blocked && (state.latest?.settings.canEdit ?? snapshot.settings.canEdit);
  const unlocked = state.phase === 'ready' && !state.more, editable = unlocked && owner;
  const publishable = editable && state.validatedKey === `${state.target}\n${state.draft}` && state.privacyReviewed;
  const validated = state.validatedKey === `${state.target}\n${state.draft}` && Boolean(state.report?.valid);
  const openJson = () => { setEditMode('json'); requestAnimationFrame(() => inputRef.current?.focus()); };
  const loadVersion = (version: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.hasDraftChanges && !window.confirm(t('settings:confirmLoadVersion', { version }))) return;
    void editor.selectVersion(version, { discardDraft: true });
  };
  let preview: { events: unknown[]; workflows: unknown[]; funnels?: unknown[] } | null = null;
  try { preview = readDraft(state.draft); } catch { /* Invalid JSON remains in the editor until explicitly validated. */ }
  return <section className="settings-section schema-section" aria-labelledby="schema-heading" aria-busy={busy || undefined}>
    <div className="settings-head"><h2 id="schema-heading">{t('settings:schemaTitle')}</h2>
      <span className="settings-badge">{snapshot.page.latestVersion === null ? t('settings:firstSchema') : t('settings:currentVersion', { version: snapshot.page.latestVersion })}</span>
      {(state.blocked || !owner) && <span className="settings-badge">{state.blocked ? t('settings:permissionRequired') : t('settings:readOnly')}</span>}
      <span className="field-help">{state.target ? t('settings:draftVersion', { version: state.target }) : t('settings:draftInProgress')}</span></div>
    <p className="context-note">{t('settings:schemaIntro')}</p>
    {state.blocked ? <p className="notice">{t('settings:schemaBlocked')}</p>
      : !owner && <p className="notice">{t('settings:schemaReadOnly')}</p>}
    <div className="schema-utilities"><details className="schema-utility"><summary>{t('settings:publishedVersions')}</summary>
    <div className="schema-toolbar"><p>{t('settings:latestQueriedVersion')} <strong>{snapshot.page.latestVersion === null ? t('settings:noneYet') : `v${snapshot.page.latestVersion}`}</strong></p>
      <button className="secondary-button" disabled={busy || state.more} onClick={() => { void editorRef.current?.refresh(); }}>{t('settings:refreshList')}</button></div>
    <div className="table-scroll" tabIndex={0} aria-label={t('settings:schemaVersionList')}><table className="event-table">
      <caption className="sr-only">{t('settings:publishedSchemaVersionsCaption')}</caption>
      <thead><tr><th scope="col">{t('settings:version')}</th><th scope="col">{t('settings:status')}</th><th scope="col">{t('settings:publishedDate')}</th><th scope="col">{t('settings:definition')}</th></tr></thead>
      <tbody>{snapshot.page.data.length ? snapshot.page.data.map(row => <tr key={row.schemaVersion}>
        <th scope="row">v{row.schemaVersion}</th><td>{row.schemaStatus === 'active' ? t('settings:active') : t('settings:retired')}</td>
        <td><time dateTime={row.publishedAt}>{new Date(row.publishedAt).toLocaleDateString(locale, { timeZone: snapshot.settings.project.timeZone })}</time></td>
        <td><button className="secondary-button" disabled={!unlocked} onClick={() => loadVersion(row.schemaVersion)}>{t('settings:loadVersion', { version: row.schemaVersion })}</button></td>
      </tr>) : <tr><td colSpan={4}>{t('settings:noPublishedSchemas')}</td></tr>}</tbody>
    </table></div>
    {snapshot.page.page.beforeVersion !== null && <button className="secondary-button" disabled={!unlocked} onClick={() => { void editorRef.current?.loadMore(); }}>{state.more ? t('settings:loading') : t('settings:loadOlderVersions')}</button>}
    <p className="field-help">{t('settings:loadVersionHelp')}</p>
    </details><details className="schema-utility"><summary>{t('settings:compareVersions')}</summary>
    <SchemaVersionComparison key={projectId} client={client} projectId={projectId} versions={snapshot.page.data}
      enabled={unlocked && !state.blocked} refreshTick={refreshTick} />
    </details><details className="schema-utility"><summary>{t('settings:draftFilesAndServer')}</summary>
    {editorRef.current && <SchemaDraftFiles editor={editorRef.current} editable={editable} projectId={projectId} />}
    {editorRef.current && <ServerSchemaDraft key={projectId} editor={editorRef.current} client={client} projectId={projectId} editable={editable} />}
    </details></div>
    {state.message && <p className="settings-message" role="status">{messageText(state.message)}</p>}
    {state.phase === 'review' && <section className="settings-recovery" aria-label={t('settings:schemaRecoveryLabel')}>
      <h3>{t('settings:reviewPublication')}</h3>
      <button className="secondary-button" onClick={() => { void editorRef.current?.checkLatest(); }}>{t('settings:checkServer')}</button>
      {state.latest && <>
        <p>{t('settings:serverLatestVersion')} {state.latest.page.latestVersion === null ? t('settings:none') : `v${state.latest.page.latestVersion}`}</p>
        <div className="schema-comparison">
          <div><h4>{t('settings:latestServerDefinition')}</h4><pre tabIndex={0} aria-label={t('settings:latestServerDefinition')}>{JSON.stringify(state.latest.definitions, null, 2)}</pre></div>
          <div><h4>{t('settings:myDraft')}</h4><pre tabIndex={0} aria-label={t('settings:preservedDraft')}>{state.draft}</pre></div>
        </div>
        <div className="form-actions"><button className="primary-button" onClick={() => editorRef.current?.useServer()}>{t('settings:useServerDefinition')}</button>
          <button className="secondary-button" disabled={!state.latest.settings.canEdit} onClick={() => editorRef.current?.keepDraft()}>{t('settings:keepDraftAndReview')}</button></div>
      </>}
    </section>}
    <form className="schema-form schema-workbench" onSubmit={event => { event.preventDefault(); void editorRef.current?.publish(); }} noValidate>
      <div className="schema-editing-pane">
      <div className="schema-edit-mode" role="group" aria-label={t('settings:editModeLabel')}>
        <button type="button" aria-pressed={editMode === 'json'} onClick={openJson}>{t('settings:editJson')}</button>
        <button type="button" aria-pressed={editMode === 'form'} onClick={() => setEditMode('form')}>{t('settings:editForm')}</button>
      </div>
      <div className="settings-field schema-version-field"><label className="field-label" htmlFor="schema-version">{t('settings:newVersionToPublish')}</label>
        <input className="text-input" id="schema-version" inputMode="numeric" title={t('settings:versionInputHelp')} value={state.target} disabled={!editable} onChange={e => editorRef.current?.edit('target', e.target.value)} aria-describedby="schema-version-help" />
        <p className="field-help" id="schema-version-help">{t('settings:versionInputHelp')}</p></div>
      <div hidden={editMode !== 'form'}>
      <SchemaEventForm draft={state.draft} editable={editable} issue={issue} onChange={next => editorRef.current?.edit('draft', next)}
        onOpenJson={openJson} />
      <SchemaWorkflowForm draft={state.draft} editable={editable} issue={issue} onChange={next => editorRef.current?.edit('draft', next)}
        onOpenJson={openJson} />
      <SchemaFunnelForm draft={state.draft} editable={editable} issue={issue} onChange={next => editorRef.current?.edit('draft', next)}
        onOpenJson={openJson} />
      </div>
      <div className="schema-json-editor" hidden={editMode !== 'json'}>
      <div className="settings-field"><label className="field-label" htmlFor="schema-draft">{t('settings:schemaDefinitionJson')}</label>
        <textarea id="schema-draft" ref={inputRef} className="text-input schema-textarea" rows={18} spellCheck={false} value={state.draft} readOnly={!editable}
          onChange={e => editorRef.current?.edit('draft', e.target.value)} aria-invalid={Boolean(state.formError || issue) || undefined} aria-describedby="schema-draft-help schema-errors" />
        <p className="field-help" id="schema-draft-help">{t('settings:schemaDefinitionHelp')}</p>
      </div></div>
        <div id="schema-errors">{state.formError && <p className="form-error" role="alert">{messageText(state.formError)}</p>}
          {issue && <p className="form-error" role="alert"><code>{issue.path || t('settings:wholeDefinition')}</code> — {t(`settings:${ISSUE_TEXT[issue.code]}`)}</p>}</div>
      <details className="schema-preview"><summary>{t('settings:draftPreview')}{preview ? t('settings:draftPreviewCounts', { events: preview.events.length, workflows: preview.workflows.length, funnels: preview.funnels?.length ?? 0 }) : ''}</summary>
        {preview ? <div className="table-scroll" tabIndex={0} aria-label={t('settings:draftEventList')}><table className="event-table"><caption className="sr-only">{t('settings:draftEventsCaption')}</caption>
          <thead><tr><th scope="col">{t('settings:event')}</th><th scope="col">{t('settings:displayName')}</th><th scope="col">{t('settings:source')}</th></tr></thead>
          <tbody>{preview.events.slice(0, 50).map((item, index) => { const r = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const text = (key: string) => typeof r[key] === 'string' ? String(r[key]) : '—';
            return <tr key={index}><th scope="row">{text('name')}</th><td>{text('label')}</td><td>{text('source')}</td></tr>; })}</tbody></table></div>
          : <p>{t('settings:previewJsonHelp')}</p>}
      </details>
      </div>
      <aside className="schema-inspector" aria-label={t('settings:prePublishChecks')}>
      <h3>{t('settings:prePublishChecks')}</h3>
      <div className={`schema-check${validated ? ' complete' : ''}`}>
        {validated ? <CheckCircle size={22} weight="fill" /> : <Circle size={22} />}
        <div><strong>{validated ? t('settings:definitionValid') : t('settings:definitionNeedsValidation')}</strong><p className="field-help">{t('settings:definitionValidationHelp')}</p></div>
      </div>
      {validated && preview && <p className="schema-definition-count">{t('settings:draftDefinitionCounts', { events: preview.events.length, workflows: preview.workflows.length, funnels: preview.funnels?.length ?? 0 })}</p>}
      <label className="schema-privacy"><input type="checkbox" checked={state.privacyReviewed} disabled={!editable || !state.report?.valid} onChange={e => editorRef.current?.setPrivacy(e.target.checked)} />
        <span>{t('settings:privacyReviewed')}</span></label>
      <p className="field-help">{t('settings:privacyReviewHelp')}</p>
      <section className="schema-access-note"><h3>{t('settings:accessPermission')}</h3><p>{state.blocked ? t('settings:permissionRequired') : owner ? t('settings:ownerCanPublish') : t('settings:readOnlyCannotPublish')}</p></section>
      <section className="schema-access-note"><h3>{t('settings:publicationGuide')}</h3><p>{t('settings:versionsPreserved')}</p><p>{t('settings:switchSdkVersion')}</p></section>
      </aside>
      <div className="schema-action-bar"><p>{publishable ? t('settings:readyToPublish') : t('settings:publishRequirements')}</p>
      <div className="form-actions"><button className="secondary-button" type="button" disabled={!editable} onClick={() => { void editorRef.current?.validate(); }}>{state.phase === 'validating' ? t('settings:validating') : t('settings:validateDefinition')}</button>
        <button className="primary-button" type="submit" disabled={!publishable}>{state.phase === 'publishing' ? t('settings:publishing') : state.target ? t('settings:publishVersion', { version: state.target }) : t('settings:publishNewVersion')}</button></div>
      </div>
    </form>
  </section>;
}
