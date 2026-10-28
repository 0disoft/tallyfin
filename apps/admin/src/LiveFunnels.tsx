import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { ApiClient } from './api/client';
import type { DateRange } from './api/dates';
import { FunnelReport } from './api/funnel-report';
import type { FunnelReportState } from './api/funnel-report';
import type { FunnelResponse } from './api/funnel-contract';
import { funnelCsv, funnelCsvFilename } from './api/funnel-csv';
import type { FunnelDefinition, Registry } from './api/types';
import FunnelJourney from './FunnelJourney';
import { sourceLabel } from './SourceEventTable';
import './funnels.css';
import FunnelComparison from './FunnelComparison';
import { compareFunnels } from './api/funnel-comparison';
import FunnelBreakdown from './FunnelBreakdown';
import type { FunnelBreakdownState, FunnelBreakdown as Breakdown } from './api/funnel-breakdown';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import { useMessageText } from './i18n/messages';

type StepCounts = FunnelResponse['summary']['steps'][number];

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function LiveFunnels({ client, registry, range, context, previous = null, compare = false, comparisonError = null, selectedFunnelId }: {
  client: ApiClient; registry: Registry; range: DateRange; context: string;
  previous?: DateRange | null; compare?: boolean; comparisonError?: string | null;
  selectedFunnelId?: string;
}) {
  const id = useId();
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const messageText = useMessageText();
  const funnels = registry.funnels ?? [];
  const funnelIds = funnels.map(funnel => funnel.id);
  const [selection, setSelection] = useState<{ context: string; id: string }>({ context, id: '' });
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; state: FunnelReportState } | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [csvStatus, setCsvStatus] = useState<'success' | 'error' | null>(null);
  const reportRef = useRef<FunnelReport | null>(null);
  const comparisonRef = useRef<FunnelReport | null>(null);
  const [comparisonSnapshot, setComparisonSnapshot] = useState<{ client: ApiClient; current: FunnelResponse; state: FunnelReportState } | null>(null);
  const [comparisonRetry, setComparisonRetry] = useState(0);
  const [grouping, setGrouping] = useState({ context: '', funnelId: '', value: '' });
  const [breakdownSnapshot, setBreakdownSnapshot] = useState<{ client: ApiClient; current: FunnelResponse | null; state: FunnelBreakdownState } | null>(null);
  const [previousBreakdownSnapshot, setPreviousBreakdownSnapshot] = useState<{ client: ApiClient; current: Breakdown; state: FunnelBreakdownState } | null>(null);

  // One report per client. dispose() aborts in-flight reads, so a new client or
  // unmount never leaves a request running against the previous session.
  useEffect(() => {
    const report = new FunnelReport(client, next => {
      if (reportRef.current === report) setSnapshot({ client, state: next });
    });
    reportRef.current = report;
    return () => {
      if (reportRef.current === report) reportRef.current = null;
      report.dispose();
    };
  }, [client]);

  // A selection only counts in the context it was made and only for a registered
  // id; a new context renders blank before any fetch runs.
  const requestedId = selectedFunnelId ?? (selection.context === context ? selection.id : '');
  const selectedId = funnelIds.includes(requestedId) ? requestedId : '';

  // Only a selected funnel is fetched; the report validates the requested
  // registry/range and discards stale responses. Deselecting cancels the read.
  useEffect(() => {
    const report = reportRef.current;
    if (!report || !selectedId || !funnelIds.includes(selectedId)) return;
    report.load(registry, range, selectedId, context).catch(() => {});
    return () => report.cancel();
  }, [client, registry, range, selectedId, context, retryTick]);

  // A different funnel (or no funnel) starts with a clean detail and CSV state.
  useEffect(() => {
    setSelectedDay(null);
    setCsvStatus(null);
  }, [selectedId]);

  // Render guard: nothing owned by a previous client, context or selection shows.
  const view = snapshot && snapshot.client === client && snapshot.state.context === context
    && snapshot.state.funnelId === selectedId ? snapshot.state : null;
  const data = view?.phase === 'ready' ? view.data ?? null : null;
  const groupBy = grouping.context === context && grouping.funnelId === selectedId && data?.definition.dimensions.includes(grouping.value) ? grouping.value : '';
  const breakdownChanged = useCallback((state: FunnelBreakdownState) => setBreakdownSnapshot({ client, current: data, state }), [client, data]);
  const breakdownData = groupBy && breakdownSnapshot?.client === client && breakdownSnapshot.current === data && breakdownSnapshot.state.groupBy === groupBy
    && breakdownSnapshot.state.phase === 'ready' ? breakdownSnapshot.state.data : undefined;
  const breakdownComparisonKey = JSON.stringify([context, selectedId, groupBy, previous?.from, previous?.to]);
  const previousBreakdownChanged = useCallback((current: Breakdown, state: FunnelBreakdownState) => setPreviousBreakdownSnapshot({ client, current, state }), [client]);
  const previousBreakdownData = compare && !comparisonError && previous && breakdownData && previousBreakdownSnapshot?.client === client
    && previousBreakdownSnapshot.current === breakdownData && previousBreakdownSnapshot.state.context === breakdownComparisonKey
    && previousBreakdownSnapshot.state.phase === 'ready' ? previousBreakdownSnapshot.state.data : undefined;
  const comparisonKey = JSON.stringify([context, selectedId, previous?.from, previous?.to]);
  useEffect(() => {
    if (!compare || !previous || !data || comparisonError) { setComparisonSnapshot(null); return; }
    const report = new FunnelReport(client, next => {
      if (comparisonRef.current !== report) return;
      if (next.phase === 'ready' && next.data) {
        try { compareFunnels(data, next.data); }
        catch { next = { phase: 'error', context: comparisonKey, funnelId: selectedId }; }
      }
      setComparisonSnapshot({ client, current: data, state: next });
    });
    comparisonRef.current = report;
    void report.load(registry, previous, selectedId, comparisonKey);
    return () => {
      if (comparisonRef.current === report) comparisonRef.current = null;
      report.dispose();
    };
  }, [client, registry, data, compare, previous?.from, previous?.to, comparisonError, selectedId, comparisonKey, comparisonRetry]);
  const comparisonView = compare && data && comparisonSnapshot?.client === client && comparisonSnapshot.current === data
    && comparisonSnapshot.state.context === comparisonKey ? comparisonSnapshot.state : null;
  const previousData = comparisonView?.phase === 'ready' ? comparisonView.data : undefined;
  const loading = Boolean(selectedId) && (!view || view.phase === 'loading' || view.phase === 'idle');
  const csvReady = Boolean(data && data.funnelId === selectedId && data.meta.projectId === registry.project.id
    && data.meta.schemaVersion === registry.schemaVersion && (!compare || (!comparisonError && previousData)) && (!groupBy || breakdownData && (!compare || previousBreakdownData)));
  const activeDay = data && selectedDay ? data.days.find(day => day.date === selectedDay) ?? null : null;

  const declaredLabel = (step: { eventName: string; source: 'browser' | 'server' }) =>
    registry.events.find(event => event.name === step.eventName && event.source === step.source)?.label ?? step.eventName;

  const choose = (value: string) => {
    setSnapshot(null);
    setSelection({ context, id: value });
  };

  const stepRows = (steps: StepCounts[], definition: FunnelDefinition) => steps.map(step => {
    const declared = definition.steps[step.stepIndex];
    return <tr key={step.stepIndex}>
      <th scope="row"><span className="funnel-step">{t('analysis:funnelStepLabel', { stage: step.stepIndex + 1 })}</span></th>
      <td className="funnel-event-cell">
        <span className="funnel-event-stack">
          <span className="funnel-event-label">{declared ? declaredLabel(declared) : '—'}</span>
          {declared && <span className="funnel-event-name">{declared.eventName}</span>}
        </span>
      </td>
      <td className="funnel-source">{declared ? sourceLabel(declared.source, { server: t('analysis:sourceServer'), browser: t('analysis:sourceBrowser') }) : '—'}</td>
      <td className="number-cell">{formatCount(step.reachedRuns)}</td>
      <td className="number-cell funnel-rate">
        {formatRate(step.reachRate)}
        {step.reachRate !== null && <progress className="funnel-track" max={100} value={clampPercent(step.reachRate)} aria-hidden="true" />}
      </td>
      <td className="number-cell">{formatRate(step.conversionRate)}</td>
      <td className="number-cell">{step.notReachedNext === null ? '—' : formatCount(step.notReachedNext)}</td>
    </tr>;
  });

  const stepHead = <tr>
    <th scope="col">{t('analysis:stage')}</th>
    <th scope="col">{t('analysis:event')}</th>
    <th scope="col">{t('analysis:sourceGroup')}</th>
    <th scope="col" className="number-cell">{t('analysis:reached')}</th>
    <th scope="col" className="number-cell">{t('analysis:reachFromFirst')}</th>
    <th scope="col" className="number-cell">{t('analysis:conversionFromPrevious')}</th>
    <th scope="col" className="number-cell">{t('analysis:notReachedNext')}</th>
  </tr>;

  const download = () => {
    if (!csvReady || !data) return;
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([funnelCsv(data, compare ? previousData : undefined, breakdownData, previousBreakdownData)], { type: 'text/csv;charset=utf-8' }));
      link = document.createElement('a');
      link.href = url;
      link.download = funnelCsvFilename(data);
      document.body.append(link);
      link.click();
      setCsvStatus('success');
    } catch {
      setCsvStatus('error');
    } finally {
      link?.remove();
      if (url) { const release = url; setTimeout(() => URL.revokeObjectURL(release), 1000); }
    }
  };

  if (!funnels.length) return null;
  return <section className="funnel-section" aria-labelledby={`${id}-heading`}>
    <p className="goal-eyebrow">{t('analysis:funnelBreadcrumb')} <code>{selectedId || t('analysis:registeredGoal')}</code></p>
    <div className="section-header"><h2 id={`${id}-heading`}>{funnels.find(funnel => funnel.id === selectedId)?.label ?? t('analysis:funnelAnalysis')}</h2></div>
    {selectedFunnelId === undefined && <label className="api-field property-grouping" htmlFor={`${id}-select`}>
      <span>{t('analysis:selectFunnel')}</span>
      <select id={`${id}-select`} className="text-input settings-select" value={selectedId} onChange={event => choose(event.target.value)}>
        <option value="">{t('analysis:selectFunnelPlaceholder')}</option>
        {funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.label}</option>)}
      </select>
    </label>}
    {!selectedId && <p className="context-note" role="status">{t('analysis:selectFunnelHelp')}</p>}
    {loading && <section className="state-panel" role="status" aria-busy="true"><h2>{t('analysis:funnelLoadingTitle')}</h2><p>{t('analysis:funnelLoadingBody')}</p></section>}
    {selectedId && view?.phase === 'error' && <section className="state-panel" role="alert">
      <WarningCircle size={32} />
      <h2>{t('analysis:funnelLoadErrorTitle')}</h2>
      <p>{view.error?.message ? messageText(view.error.message) : t('analysis:funnelRequestIncomplete')}</p>
      <div className="state-actions"><button className="secondary-button" type="button" onClick={() => setRetryTick(tick => tick + 1)}>{t('admin:retry')}</button></div>
    </section>}
    {data && <>
      <div className="funnel-summary">
        <div>
          <p className="context-note">{t('analysis:funnelCohortMeta', { timeZone: data.meta.timeZone, version: data.meta.schemaVersion })}</p>
        </div>
        <div className="funnel-ratio">
          <strong>{formatRate(data.summary.completionRate)}</strong>
          <span>{t('analysis:completedStarted', { completed: formatCount(data.summary.completedRuns), started: formatCount(data.summary.startedRuns) })}</span>
        </div>
      </div>
      <dl className="goal-outcomes funnel-facts">
        <div><dt>{t('analysis:started')}</dt><dd>{formatCount(data.summary.startedRuns)}</dd><span>{t('analysis:startedRun')}</span></div>
        <div className="success"><dt>{t('analysis:completed')}</dt><dd>{formatCount(data.summary.completedRuns)}</dd><span>{t('analysis:completedRun')}</span></div>
        <div className="pending"><dt>{t('analysis:beforeCompletion')}</dt><dd>{formatCount(data.summary.startedRuns - data.summary.completedRuns)}</dd><span>{t('analysis:notConfirmedFailure')}</span></div>
      </dl>
      {compare && <>
        {comparisonError ? <p className="notice" role="status">{messageText(comparisonError)} {t('analysis:funnelComparisonCsvBlocked')}</p>
          : comparisonView?.phase === 'error' ? <div role="alert"><p>{t('analysis:previousFunnelLoadError')}</p>
            <button className="secondary-button" type="button" onClick={() => setComparisonRetry(tick => tick + 1)}>{t('analysis:retryFunnelComparison')}</button></div>
          : previousData ? <FunnelComparison current={data} previous={previousData} />
          : <p role="status" aria-busy="true">{t('analysis:loadingPreviousFunnel')}</p>}
      </>}
      {data.days.some(day => day.provisional) && <p className="notice" role="status">{t('analysis:funnelProvisionalNotice')}</p>}
      {data.summary.startedRuns === 0 && <p className="notice" role="status">{t('analysis:funnelNoStarts')}</p>}
      <p className="context-note">{t('analysis:funnelNonReachNote')}</p>
      <FunnelJourney data={data} registry={registry} />
      <details className="goal-definition"><summary>{t('analysis:showStageValues')}</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:funnelStageTable', { funnel: data.definition.label })}>
        <table className="event-table funnel-table">
          <caption className="sr-only">{t('analysis:funnelStageCaption', { funnel: data.definition.label })}</caption>
          <thead>{stepHead}</thead>
          <tbody>{stepRows(data.summary.steps, data.definition)}</tbody>
        </table>
      </div>
      <p className="context-note">{t('analysis:funnelStageNote')}</p>
      </details>
      <details className="funnel-daily">
        <summary>{t('analysis:dailyCohort', { days: data.days.length })}</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:funnelDailyTable', { funnel: data.definition.label })}>
          <table className="event-table funnel-table">
            <caption className="sr-only">{t('analysis:dailyCohortCaption')}</caption>
            <thead><tr>
              <th scope="col">{t('analysis:startDate')}</th>
              <th scope="col" className="number-cell">{t('analysis:startedRuns')}</th>
              <th scope="col" className="number-cell">{t('analysis:completedRuns')}</th>
              <th scope="col" className="number-cell">{t('analysis:completionRate')}</th>
              <th scope="col">{t('analysis:status')}</th>
            </tr></thead>
            <tbody>{data.days.map(day => <tr key={day.date}>
              <th scope="row"><button className="text-button funnel-day" type="button" aria-pressed={selectedDay === day.date} onClick={() => setSelectedDay(previous => previous === day.date ? null : day.date)}>{day.date}</button></th>
              <td className="number-cell">{formatCount(day.startedRuns)}</td>
              <td className="number-cell">{formatCount(day.completedRuns)}</td>
              <td className="number-cell">{formatRate(day.completionRate)}</td>
              <td>{day.provisional ? <span className="funnel-provisional">{t('analysis:provisional')}</span> : t('analysis:confirmed')}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="context-note">{t('analysis:cohort48Hours')}</p>
        {activeDay && <>
          <h4 className="funnel-day-heading">{t('analysis:dayStageBreakdown', { date: activeDay.date })}{activeDay.provisional ? t('analysis:provisionalSuffix') : ''}</h4>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:dayStageTable', { date: activeDay.date })}>
            <table className="event-table funnel-table">
              <caption className="sr-only">{t('analysis:dayStageCaption', { date: activeDay.date })}</caption>
              <thead>{stepHead}</thead>
              <tbody>{stepRows(activeDay.steps, data.definition)}</tbody>
            </table>
          </div>
        </>}
      </details>
      <FunnelBreakdown client={client} registry={registry} current={data} context={context} groupBy={groupBy} onState={breakdownChanged}
        compare={compare} previous={previous} comparisonError={comparisonError} comparisonContext={breakdownComparisonKey} onPreviousState={previousBreakdownChanged}
        onSelect={value => { setGrouping({ context, funnelId: selectedId, value }); setBreakdownSnapshot(null); setCsvStatus(null); }} />
    </>}
    {selectedId && <div className="csv-export funnel-csv">
      <button className="secondary-button" type="button" disabled={!csvReady} onClick={download} aria-describedby={`${id}-csv-status`}>{t('analysis:downloadFunnelCsv')}</button>
      <p id={`${id}-csv-status`} className={csvStatus === 'error' ? 'form-error' : 'context-note'} role={csvStatus === 'error' ? 'alert' : 'status'}>
        {csvReady ? csvStatus === 'success' ? t('analysis:funnelCsvRequested') : csvStatus === 'error' ? t('analysis:funnelCsvFailed')
            : compare ? t('analysis:funnelCsvCompareHelp') : t('analysis:funnelCsvHelp')
          : groupBy && (!breakdownData || compare && !previousBreakdownData) ? t('analysis:funnelCsvBreakdownBlocked')
          : compare && data ? t('analysis:funnelCsvCompareBlocked') : t('analysis:funnelCsvLoadBlocked')}
      </p>
    </div>}
  </section>;
}
