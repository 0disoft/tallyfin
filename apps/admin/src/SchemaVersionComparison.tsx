import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { ApiError } from './api/api-error.ts';
import type { SchemaMetadata } from './api/schema-contract.ts';
import { loadSchemaComparison, type SchemaChange, type SchemaComparison } from './api/schema-comparison.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';
import './schema-version-comparison.css';

const SECTIONS = { event: 'sectionEvent', property: 'sectionProperty', workflow: 'sectionWorkflow', funnel: 'sectionFunnel', schema: 'sectionSchema' } as const satisfies Record<SchemaChange['section'], string>;
const FIELDS = { definition: 'fieldDefinition', label: 'fieldLabel', source: 'fieldSource', type: 'fieldType', required: 'fieldRequired',
  purpose: 'fieldPurpose', values: 'fieldValues', minimum: 'fieldMinimum', maximum: 'fieldMaximum', startEvent: 'fieldStartEvent', successEvent: 'fieldSuccessEvent',
  failureEvent: 'fieldFailureEvent', failureReasonProperty: 'fieldFailureReason', dimensions: 'fieldDimensions', steps: 'fieldSteps',
  representativeWorkflowId: 'fieldRepresentativeWorkflow', order: 'fieldOrder' } as const;
const KINDS = { added: 'kindAdded', removed: 'kindRemoved', changed: 'kindChanged' } as const satisfies Record<SchemaChange['kind'], string>;
function ChangeValue({ field, value }: { field: string; value: unknown }) {
  const { t } = useI18n();
  if (value === undefined) return <>{t('settings:none')}</>;
  if (value === null) return <>{t('settings:noneNull')}</>;
  if (field === 'definition') return <pre>{JSON.stringify(value, null, 2)}</pre>;
  if (field === 'steps' && Array.isArray(value)) return <pre>{value.map((step, index) => `${index + 1}. ${step.eventName} (${step.source})`).join('\n')}</pre>;
  const text = Array.isArray(value) ? JSON.stringify(value) : String(value);
  return <pre>{text}</pre>;
}
type Request = { client: ApiClient; projectId: string; from: number; to: number };
type Result = { request: Request; refreshTick: number; data?: SchemaComparison; error?: string; localError?: true };

export default function SchemaVersionComparison({ client, projectId, versions, enabled, refreshTick }: {
  client: ApiClient; projectId: string; versions: SchemaMetadata[]; enabled: boolean; refreshTick: number;
}) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [from, setFrom] = useState(String(versions[1]?.schemaVersion ?? ''));
  const [to, setTo] = useState(String(versions[0]?.schemaVersion ?? ''));
  const [request, setRequest] = useState<Request | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const valid = from !== '' && to !== '' && from !== to && [from, to].every(v => versions.some(row => String(row.schemaVersion) === v));
  const current = enabled && valid && request?.client === client && request.projectId === projectId &&
    String(request.from) === from && String(request.to) === to ? request : null;
  const visible = current && result?.request === current && result.refreshTick === refreshTick ? result : null;
  const loading = Boolean(current && !visible);
  useEffect(() => {
    if (!current) { setResult(null); if (request) setRequest(null); return; }
    const controller = new AbortController(); let active = true;
    void loadSchemaComparison(client, projectId, current.from, current.to, controller.signal).then(
      data => { if (active) setResult({ request: current, refreshTick, data }); },
      error => { if (active) setResult({ request: current, refreshTick,
        ...(error instanceof ApiError ? { error: error.message } : { localError: true }) }); },
    );
    return () => { active = false; controller.abort(); };
  }, [client, projectId, current, request, refreshTick]);
  const select = (side: 'from' | 'to', value: string) => {
    setRequest(null); setResult(null);
    if (side === 'from') setFrom(value); else setTo(value);
  };
  const fieldText = (field: string) => {
    const key = FIELDS[field as keyof typeof FIELDS];
    return key ? t(`settings:${key}`) : field;
  };
  return <section className="schema-version-comparison" aria-labelledby="schema-comparison-heading" aria-busy={loading || undefined}>
    <h3 id="schema-comparison-heading">{t('settings:compareDefinitions')}</h3>
    <p className="context-note">{t('settings:compareDefinitionsHelp')}</p>
    {versions.length < 2 ? <p role="status">{t('settings:needTwoVersions')}</p> : <>
      <form className="schema-compare-controls" onSubmit={event => {
        event.preventDefault();
        if (enabled && valid) { setResult(null); setRequest({ client, projectId, from: Number(from), to: Number(to) }); }
      }}>
        {(['from', 'to'] as const).map(side => <label className="settings-field" key={side}>
          <span className="field-label">{side === 'from' ? t('settings:baseVersion') : t('settings:compareVersion')}</span>
          <select className="text-input" value={side === 'from' ? from : to} disabled={!enabled}
            onChange={event => select(side, event.target.value)} aria-describedby="schema-compare-help">
            <option value="">{t('settings:selectVersion')}</option>
            {versions.map(row => <option key={row.schemaVersion} value={row.schemaVersion}>v{row.schemaVersion}{row.schemaStatus === 'retired' ? ` · ${t('settings:retired')}` : ''}</option>)}
          </select>
        </label>)}
        <button className="secondary-button" type="submit" disabled={!enabled || !valid || loading}>
          {loading ? t('settings:comparing') : visible?.error || visible?.localError ? t('settings:compareAgain') : t('settings:compareDefinitionsAction')}
        </button>
      </form>
      <p className="field-help" id="schema-compare-help">{t('settings:selectDifferentVersions')}</p>
      {!enabled && <p role="status">{t('settings:comparisonLocked')}</p>}
      {loading && <p role="status">{t('settings:loadingComparison')}</p>}
      {visible?.error && <p className="form-error" role="alert">{messageText(visible.error)}</p>}
      {visible?.localError && <p className="form-error" role="alert">{t('settings:definitionLoadFailed')}</p>}
      {visible?.data && <>
        <p role="status">{t('settings:comparisonSummary', { from: visible.data.from, to: visible.data.to, changes: visible.data.changes.length ? t('settings:changeCount', { count: visible.data.changes.length }) : t('settings:noDefinitionChanges') })}</p>
        <p className="notice">{t('settings:comparisonSemanticsNotice')}</p>
        {visible.data.changes.length > 0 && <><p className="field-help">{t('settings:scrollComparisonHelp')}</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('settings:schemaDefinitionDiff')}>
          <table className="event-table schema-definition-diff">
            <caption className="sr-only">{t('settings:comparisonCaption', { from: visible.data.from, to: visible.data.to })}</caption>
            <thead><tr><th scope="col">{t('settings:comparisonSectionItem')}</th><th scope="col">{t('settings:changedField')}</th><th scope="col">{t('settings:difference')}</th><th scope="col">{t('settings:baseVersionColumn', { version: visible.data.from })}</th><th scope="col">{t('settings:compareVersionColumn', { version: visible.data.to })}</th></tr></thead>
            <tbody>{visible.data.changes.map((change, index) => <tr key={index}>
              <th scope="row">{t(`settings:${SECTIONS[change.section]}`)}<div className="event-label">{change.field === 'order' ? t(`settings:${SECTIONS[change.name as SchemaChange['section']]}`) : change.name === 'representativeWorkflowId' ? t('settings:fieldRepresentativeWorkflow') : change.name}</div></th>
              <td>{fieldText(change.field)}</td><td>{t(`settings:${KINDS[change.kind]}`)}</td>
              <td><ChangeValue field={change.field} value={change.before} /></td><td><ChangeValue field={change.field} value={change.after} /></td>
            </tr>)}</tbody>
          </table>
        </div></>}
      </>}
    </>}
  </section>;
}
