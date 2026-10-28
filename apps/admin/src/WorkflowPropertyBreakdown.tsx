import { useEffect, useId, useState } from 'react';
import { ApiClient } from './api/client';
import type { DateRange } from './api/period-comparison';
import type { Registry, WorkflowBreakdownResponse, WorkflowDefinition } from './api/types';
import { validateWorkflowBreakdown, type WorkflowGroupingState } from './api/workflow-analysis';
import WorkflowPropertyComparison from './WorkflowPropertyComparison';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

export default function WorkflowPropertyBreakdown({ client, registry, definition, range, previous, context, onState }: {
  client: ApiClient; registry: Registry; definition: WorkflowDefinition; range: DateRange; context: string;
  previous: DateRange | null;
  onState: (workflowId: string, state: WorkflowGroupingState) => void;
}) {
  const id = useId(), [groupBy, setGroupBy] = useState(''), [retry, setRetry] = useState(0);
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const valueLabel = (value: string | number | boolean) => typeof value === 'boolean' ? value ? t('analysis:valueTrue') : t('analysis:valueFalse') : String(value);
  const [result, setResult] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; data?: WorkflowBreakdownResponse }>({ key: '', status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [comparisonRetry, setComparisonRetry] = useState(0);
  const [comparison, setComparison] = useState<typeof result>({ key: '', status: 'loading' });
  const key = JSON.stringify([context, definition.id, groupBy, retry]);
  const current = result.key === key ? result : null;
  const previousFrom = previous?.from, previousTo = previous?.to;
  const comparisonKey = JSON.stringify([key, previousFrom, previousTo, comparisonRetry]);
  const before = comparison.key === comparisonKey ? comparison : null;
  const choose = (value: string) => {
    setGroupBy(value); setSelected(null);
    onState(definition.id, { context, groupBy: value, status: value ? 'loading' : 'idle' });
  };
  useEffect(() => {
    if (!groupBy) return;
    const controller = new AbortController();
    setResult({ key, status: 'loading' });
    client.getWorkflowBreakdown(registry.project.id, definition.id, { schemaVersion: registry.schemaVersion,
      ...range, groupBy, signal: controller.signal })
      .then(data => {
        validateWorkflowBreakdown(data, registry, range, definition.id, groupBy);
        if (controller.signal.aborted) return;
        setResult({ key, status: 'ready', data });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult({ key, status: 'error' });
      });
    return () => controller.abort();
  }, [client, registry, definition, range, context, groupBy, key, onState]);
  useEffect(() => {
    if (!groupBy || current?.status !== 'ready' || !previousFrom || !previousTo) return;
    const controller = new AbortController(), previousRange = { from: previousFrom, to: previousTo };
    setComparison({ key: comparisonKey, status: 'loading' });
    client.getWorkflowBreakdown(registry.project.id, definition.id, { schemaVersion: registry.schemaVersion,
      ...previousRange, groupBy, signal: controller.signal })
      .then(data => {
        validateWorkflowBreakdown(data, registry, previousRange, definition.id, groupBy);
        if (!controller.signal.aborted) setComparison({ key: comparisonKey, status: 'ready', data });
      })
      .catch(() => { if (!controller.signal.aborted) setComparison({ key: comparisonKey, status: 'error' }); });
    return () => controller.abort();
  }, [client, registry, definition, groupBy, current?.status, previousFrom, previousTo, comparisonKey]);
  useEffect(() => {
    onState(definition.id, { context, groupBy, status: groupBy ? current?.status ?? 'loading' : 'idle', data: current?.data,
      comparisonStatus: groupBy && previousFrom && previousTo ? before?.status ?? 'loading' : 'idle',
      comparisonData: previousFrom && previousTo ? before?.data : undefined });
  }, [onState, definition.id, context, groupBy, result, key, comparison, comparisonKey, previousFrom, previousTo]);
  const buckets = current?.status === 'ready' ? [...current.data!.buckets].sort((a, b) => b.summary.startedAttempts - a.summary.startedAttempts) : [];
  const active = buckets.find(bucket => JSON.stringify(bucket.value) === selected);
  const cells = (value: WorkflowBreakdownResponse['summary']) => <><td className="number-cell">{formatCount(value.startedAttempts)}</td><td className="number-cell">{formatCount(value.succeededAttempts)}</td><td className="number-cell">{value.failedAttempts === null ? '—' : formatCount(value.failedAttempts)}</td><td className="number-cell">{formatCount(value.pendingAttempts)}</td><td className="number-cell">{formatRate(value.completionRate)}</td></>;
  const headings = <><th scope="col" className="number-cell">{t('analysis:started')}</th><th scope="col" className="number-cell">{t('analysis:succeeded')}</th><th scope="col" className="number-cell">{t('analysis:failed')}</th><th scope="col" className="number-cell">{t('analysis:pending')}</th><th scope="col" className="number-cell">{t('analysis:completionRate')}</th></>;
  return <section className="workflow-property-analysis" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>{t('analysis:workflowPropertyRate')}</h3>
    <label className="api-field property-grouping" htmlFor={`${id}-group`}><span>{t('analysis:startGroupBy')}</span><select id={`${id}-group`} className="text-input settings-select" value={groupBy} onChange={event => choose(event.target.value)} disabled={!definition.dimensions.length}>
      <option value="">{t('analysis:noGrouping')}</option>{definition.dimensions.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <p className="context-note">{definition.dimensions.length ? t('analysis:workflowPropertyHelp') : t('analysis:workflowPropertyNoDimensions')}</p>
    {groupBy && (!current || current.status === 'loading') && <p role="status">{t('analysis:loadingWorkflowProperties')}</p>}
    {groupBy && current?.status === 'error' && <div role="alert"><p>{t('analysis:workflowPropertiesLoadError')}</p><button className="secondary-button" type="button" onClick={() => { onState(definition.id, { context, groupBy, status: 'loading' }); setRetry(value => value + 1); }}>{t('analysis:retryWorkflowProperties')}</button></div>}
    {groupBy && current?.status === 'ready' && (buckets.length === 0 ? <p role="status">{t('analysis:noWorkflowPropertyValues')}</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label={t('analysis:workflowPropertyTable', { workflow: definition.label })}><table className="event-table"><caption className="sr-only">{t('analysis:workflowPropertyCaption', { groupBy })}</caption><thead><tr><th scope="col">{t('analysis:propertyValueDailyView', { property: groupBy })}</th>{headings}</tr></thead><tbody>{buckets.map(bucket => <tr key={JSON.stringify(bucket.value)}><th scope="row"><button className="text-button" type="button" aria-pressed={selected === JSON.stringify(bucket.value)} onClick={() => setSelected(JSON.stringify(bucket.value))}>{valueLabel(bucket.value)}</button></th>{cells(bucket.summary)}</tr>)}</tbody></table></div>
      <p className="context-note">{t('analysis:workflowPropertyNote')}</p>
      {active && <><h4>{t('analysis:workflowValueDailyBreakdown', { property: groupBy, value: valueLabel(active.value) })}</h4><div className="table-scroll" tabIndex={0} aria-label={t('analysis:workflowValueDailyTable', { workflow: definition.label })}><table className="event-table"><caption className="sr-only">{t('analysis:workflowValueDailyCaption')}</caption><thead><tr><th scope="col">{t('analysis:startDate')}</th>{headings}<th scope="col">{t('analysis:status')}</th></tr></thead><tbody>{active.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th>{cells(day)}<td>{day.provisional ? t('analysis:provisional') : t('analysis:confirmed')}</td></tr>)}</tbody></table></div></>}
    </>)}
    {groupBy && current?.status === 'ready' && previous && <>
      {(!before || before.status === 'loading') && <p role="status">{t('analysis:loadingPreviousWorkflowProperties')}</p>}
      {before?.status === 'error' && <div role="alert"><p>{t('analysis:previousWorkflowPropertiesError')}</p>
        <button className="secondary-button" type="button" onClick={() => setComparisonRetry(value => value + 1)}>{t('analysis:retryWorkflowPropertyComparison')}</button></div>}
      {before?.status === 'ready' && <WorkflowPropertyComparison current={current.data!} previous={before.data!} registry={registry} />}
    </>}
  </section>;
}
