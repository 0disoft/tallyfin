import { useEffect, useId, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import type { Registry } from './api/types';
import type { FunnelResponse } from './api/funnel-contract';
import { FunnelBreakdownReport, type FunnelBreakdownState, type FunnelBreakdown as Breakdown } from './api/funnel-breakdown';
import { sourceLabel } from './SourceEventTable';
import type { DateRange } from './api/dates';
import { compareFunnelBreakdowns, funnelValueKey } from './api/funnel-breakdown-comparison';
import FunnelBreakdownComparison from './FunnelBreakdownComparison';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import { useMessageText } from './i18n/messages';

export default function FunnelBreakdown({ client, registry, current, context, groupBy, onSelect, onState, compare, previous, comparisonError, comparisonContext, onPreviousState }: {
  client: ApiClient; registry: Registry; current: FunnelResponse; context: string; groupBy: string;
  onSelect: (value: string) => void; onState: (state: FunnelBreakdownState) => void;
  compare: boolean; previous: DateRange | null; comparisonError: string | null; comparisonContext: string;
  onPreviousState: (current: Breakdown, state: FunnelBreakdownState) => void;
}) {
  const id = useId(), ref = useRef<FunnelBreakdownReport | null>(null);
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const messageText = useMessageText();
  const [snapshot, setSnapshot] = useState<{ current: FunnelResponse; client: ApiClient; state: FunnelBreakdownState } | null>(null);
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const previousRef = useRef<FunnelBreakdownReport | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<{ client: ApiClient; data: Breakdown; state: FunnelBreakdownState } | null>(null);
  const [comparisonRetry, setComparisonRetry] = useState(0);
  const key = JSON.stringify([context, current.funnelId, current.meta.from, current.meta.to, groupBy]);
  useEffect(() => {
    setSelection(null);
    if (!groupBy) { setSnapshot(null); return; }
    const report = new FunnelBreakdownReport(client, state => {
      if (ref.current !== report) return;
      setSnapshot({ current, client, state }); onState(state);
    });
    ref.current = report;
    void report.load(registry, current.meta, current.funnelId, groupBy, key);
    return () => { if (ref.current === report) ref.current = null; report.dispose(); };
  }, [client, registry, current, groupBy, key, retry, onState]);
  const state = snapshot?.client === client && snapshot.current === current && snapshot.state.context === key ? snapshot.state : null;
  const data = groupBy && state?.phase === 'ready' ? state.data : undefined;
  useEffect(() => {
    if (!compare || !previous || !data || comparisonError) { setPreviousSnapshot(null); return; }
    const report = new FunnelBreakdownReport(client, state => {
      if (previousRef.current !== report) return;
      if (state.phase === 'ready' && state.data) {
        try { compareFunnelBreakdowns(data, state.data); }
        catch { state = { phase: 'error', context: comparisonContext, groupBy }; }
      }
      setPreviousSnapshot({ client, data, state }); onPreviousState(data, state);
    });
    previousRef.current = report;
    void report.load(registry, previous, current.funnelId, groupBy, comparisonContext);
    return () => { if (previousRef.current === report) previousRef.current = null; report.dispose(); };
  }, [client, registry, data, compare, previous?.from, previous?.to, comparisonError, current.funnelId, groupBy, comparisonContext, comparisonRetry, onPreviousState]);
  const previousState = compare && previousSnapshot?.client === client && previousSnapshot.data === data && previousSnapshot.state.context === comparisonContext ? previousSnapshot.state : null;
  const previousData = previousState?.phase === 'ready' ? previousState.data : undefined;
  const active = data?.buckets.find(bucket => funnelValueKey(bucket.value) === selection);
  const first = current.definition.steps[0]!;
  const event = registry.events.find(event => event.name === first.eventName && event.source === first.source);
  const label = (value: string | number | boolean) => typeof value === 'boolean' ? value ? 'true' : 'false' : String(value);
  if (!current.definition.dimensions.length) return null;
  return <section className="table-section">
    <h3>{t('analysis:funnelPropertyBreakdown')}</h3>
    <label className="api-field property-grouping" htmlFor={`${id}-property`}><span>{t('analysis:funnelGroupBy')}</span>
      <select id={`${id}-property`} className="text-input settings-select" value={groupBy} onChange={event => onSelect(event.target.value)}>
        <option value="">{t('analysis:noGrouping')}</option>{current.definition.dimensions.map(name => <option key={name} value={name}>{name} · {event?.properties[name]?.purpose ?? name}</option>)}
      </select>
    </label>
    {!groupBy && <p className="context-note">{t('analysis:selectGroupingHelp')}</p>}
    {groupBy && (!state || state.phase === 'loading') && <p role="status" aria-busy="true">{t('analysis:loadingFunnelBreakdown')}</p>}
    {groupBy && state?.phase === 'error' && <div role="alert"><p>{t('analysis:funnelBreakdownLoadError')}</p>
      <button className="secondary-button" type="button" onClick={() => setRetry(value => value + 1)}>{t('analysis:retryFunnelBreakdown')}</button></div>}
    {data && <>
      <p className="context-note">{t('analysis:funnelBreakdownMeta', { groupBy: data.groupBy, from: data.meta.from, to: data.meta.to, timeZone: data.meta.timeZone })}</p>
      {data.buckets.length === 0 ? <p role="status">{t('analysis:noFunnelBreakdownValues')}</p> : <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:funnelBreakdownTable')}><table className="event-table funnel-table">
          <caption className="sr-only">{t('analysis:funnelBreakdownCaption', { groupBy: data.groupBy })}</caption>
          <thead><tr><th scope="col">{t('analysis:propertyValues')}</th><th scope="col" className="number-cell">{t('analysis:started')}</th><th scope="col" className="number-cell">{t('analysis:completed')}</th><th scope="col" className="number-cell">{t('analysis:completionRate')}</th></tr></thead>
          <tbody>{data.buckets.map(bucket => { const key = funnelValueKey(bucket.value); return <tr key={key}>
            <th scope="row"><button type="button" className="text-button" aria-pressed={key === selection} onClick={() => setSelection(previous => previous === key ? null : key)}>{label(bucket.value)}</button></th>
            <td className="number-cell">{formatCount(bucket.summary.startedRuns)}</td><td className="number-cell">{formatCount(bucket.summary.completedRuns)}</td>
            <td className="number-cell">{formatRate(bucket.summary.completionRate)}</td></tr>; })}</tbody>
        </table></div><p className="context-note">{t('analysis:funnelBreakdownNote')}</p>
      </>}
      {data.buckets.some(bucket => bucket.days.some(day => day.provisional)) && <p className="notice" role="status">{t('analysis:provisionalFunnelBreakdown')}</p>}
      {compare && (comparisonError ? <p className="notice" role="status">{messageText(comparisonError)} {t('analysis:funnelBreakdownCsvBlocked')}</p>
        : previousState?.phase === 'error' ? <div role="alert"><p>{t('analysis:previousFunnelBreakdownError')}</p>
          <button className="secondary-button" type="button" onClick={() => setComparisonRetry(value => value + 1)}>{t('analysis:retryFunnelBreakdownComparison')}</button></div>
        : previousData ? <FunnelBreakdownComparison current={data} previous={previousData} selection={selection} onSelect={key => setSelection(value => value === key ? null : key)} />
        : <p role="status" aria-busy="true">{t('analysis:loadingPreviousFunnelBreakdown')}</p>)}
      {active && <>
        <h4>{t('analysis:valueStageBreakdown', { value: label(active.value) })}</h4>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:selectedValueFunnelStages')}><table className="event-table funnel-table">
          <caption className="sr-only">{t('analysis:selectedValueStageCaption')}</caption>
          <thead><tr><th scope="col">{t('analysis:stageEvent')}</th><th scope="col">{t('analysis:sourceGroup')}</th><th scope="col" className="number-cell">{t('analysis:reached')}</th><th scope="col" className="number-cell">{t('analysis:reachFromFirst')}</th><th scope="col" className="number-cell">{t('analysis:conversionFromPrevious')}</th></tr></thead>
          <tbody>{active.summary.steps.map(step => <tr key={step.stepIndex}><th scope="row">{t('analysis:funnelStepLabel', { stage: step.stepIndex + 1 })} · {data.definition.steps[step.stepIndex]!.eventName}</th>
            <td>{sourceLabel(data.definition.steps[step.stepIndex]!.source, { server: t('analysis:sourceServer'), browser: t('analysis:sourceBrowser') })}</td><td className="number-cell">{formatCount(step.reachedRuns)}</td><td className="number-cell">{formatRate(step.reachRate)}</td><td className="number-cell">{formatRate(step.conversionRate)}</td></tr>)}</tbody>
        </table></div>
        <details><summary>{t('analysis:valueDailyBreakdown', { value: label(active.value), days: active.days.length })}</summary>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:selectedValueDailyFunnel')}><table className="event-table funnel-table">
            <caption className="sr-only">{t('analysis:selectedValueDailyCaption')}</caption>
            <thead><tr><th scope="col">{t('analysis:startDate')}</th><th scope="col" className="number-cell">{t('analysis:started')}</th><th scope="col" className="number-cell">{t('analysis:completed')}</th><th scope="col" className="number-cell">{t('analysis:completionRate')}</th><th scope="col">{t('analysis:status')}</th></tr></thead>
            <tbody>{active.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td className="number-cell">{formatCount(day.startedRuns)}</td><td className="number-cell">{formatCount(day.completedRuns)}</td><td className="number-cell">{formatRate(day.completionRate)}</td><td>{day.provisional ? t('analysis:provisional') : t('analysis:confirmed')}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </>}
  </section>;
}
