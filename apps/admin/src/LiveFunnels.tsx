import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { ApiClient } from './api/client';
import type { DateRange } from './api/dates';
import { FunnelReport } from './api/funnel-report';
import type { FunnelReportState } from './api/funnel-report';
import type { FunnelResponse } from './api/funnel-contract';
import { funnelCsv, funnelCsvFilename } from './api/funnel-csv';
import type { FunnelDefinition, Registry } from './api/types';
import { formatCount, formatRate } from './data';
import FunnelJourney from './FunnelJourney';
import { sourceLabel } from './SourceEventTable';
import './funnels.css';
import FunnelComparison from './FunnelComparison';
import { compareFunnels } from './api/funnel-comparison';
import FunnelBreakdown from './FunnelBreakdown';
import type { FunnelBreakdownState, FunnelBreakdown as Breakdown } from './api/funnel-breakdown';

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
  const funnels = registry.funnels ?? [];
  const funnelIds = funnels.map(funnel => funnel.id);
  const [selection, setSelection] = useState<{ context: string; id: string }>({ context, id: '' });
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; state: FunnelReportState } | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [csvError, setCsvError] = useState(false);
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
    setCsvMessage(null);
    setCsvError(false);
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
      <th scope="row"><span className="funnel-step">{step.stepIndex + 1}단계</span></th>
      <td className="funnel-event-cell">
        <span className="funnel-event-stack">
          <span className="funnel-event-label">{declared ? declaredLabel(declared) : '—'}</span>
          {declared && <span className="funnel-event-name">{declared.eventName}</span>}
        </span>
      </td>
      <td className="funnel-source">{declared ? sourceLabel(declared.source) : '—'}</td>
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
    <th scope="col">단계</th>
    <th scope="col">이벤트</th>
    <th scope="col">출처</th>
    <th scope="col" className="number-cell">도달</th>
    <th scope="col" className="number-cell">첫 단계 대비 도달률</th>
    <th scope="col" className="number-cell">직전 단계 대비 전환율</th>
    <th scope="col" className="number-cell">다음 단계 미도달</th>
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
      setCsvError(false);
      setCsvMessage('CSV 다운로드를 요청했어요.');
    } catch {
      setCsvError(true);
      setCsvMessage('CSV를 만들지 못했어요. 조회 상태와 브라우저 다운로드 설정을 확인해 주세요.');
    } finally {
      link?.remove();
      if (url) { const release = url; setTimeout(() => URL.revokeObjectURL(release), 1000); }
    }
  };

  if (!funnels.length) return null;
  return <section className="funnel-section" aria-labelledby={`${id}-heading`}>
    <p className="goal-eyebrow">퍼널 / <code>{selectedId || '등록된 목표'}</code></p>
    <div className="section-header"><h2 id={`${id}-heading`}>{funnels.find(funnel => funnel.id === selectedId)?.label ?? '퍼널 분석'}</h2></div>
    {selectedFunnelId === undefined && <label className="api-field property-grouping" htmlFor={`${id}-select`}>
      <span>퍼널 선택</span>
      <select id={`${id}-select`} className="text-input settings-select" value={selectedId} onChange={event => choose(event.target.value)}>
        <option value="">퍼널을 선택하세요</option>
        {funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.label}</option>)}
      </select>
    </label>}
    {!selectedId && <p className="context-note" role="status">퍼널을 선택하면 단계별 도달·전환과 일별 내역을 조회해요. 선택하기 전에는 조회하지 않아요.</p>}
    {loading && <section className="state-panel" role="status" aria-busy="true"><h2>퍼널 집계를 조회하는 중이에요</h2><p>등록된 퍼널 정의와 시작일 코호트를 서버에서 가져와요.</p></section>}
    {selectedId && view?.phase === 'error' && <section className="state-panel" role="alert">
      <WarningCircle size={32} />
      <h2>퍼널 집계를 불러오지 못했어요</h2>
      <p>{view.error?.message ?? '요청을 마치지 못했어요. 잠시 후 다시 시도해 주세요.'}</p>
      <div className="state-actions"><button className="secondary-button" type="button" onClick={() => setRetryTick(tick => tick + 1)}>다시 시도</button></div>
    </section>}
    {data && <>
      <div className="funnel-summary">
        <div>
          <p className="context-note">시작일 기준 코호트 · {data.meta.timeZone} · 정의 v{data.meta.schemaVersion}</p>
        </div>
        <div className="funnel-ratio">
          <strong>{formatRate(data.summary.completionRate)}</strong>
          <span>완료 {formatCount(data.summary.completedRuns)} / 시작 {formatCount(data.summary.startedRuns)}</span>
        </div>
      </div>
      <dl className="goal-outcomes funnel-facts">
        <div><dt>시작</dt><dd>{formatCount(data.summary.startedRuns)}</dd><span>시작한 실행</span></div>
        <div className="success"><dt>완료</dt><dd>{formatCount(data.summary.completedRuns)}</dd><span>마지막 단계에 도달한 실행</span></div>
        <div className="pending"><dt>완료 전</dt><dd>{formatCount(data.summary.startedRuns - data.summary.completedRuns)}</dd><span>확정 실패와는 달라요</span></div>
      </dl>
      {compare && <>
        {comparisonError ? <p className="notice" role="status">{comparisonError} 비교를 끄면 현재 기간 퍼널 CSV를 내려받을 수 있어요.</p>
          : comparisonView?.phase === 'error' ? <div role="alert"><p>직전 기간 퍼널을 불러오지 못했어요. 현재 결과는 유지돼요.</p>
            <button className="secondary-button" type="button" onClick={() => setComparisonRetry(tick => tick + 1)}>퍼널 비교 다시 시도</button></div>
          : previousData ? <FunnelComparison current={data} previous={previousData} />
          : <p role="status" aria-busy="true">직전 기간 퍼널을 조회하는 중이에요.</p>}
      </>}
      {data.days.some(day => day.provisional) && <p className="notice" role="status">집계 중인 시작일이 포함돼 있어 결과가 달라질 수 있어요.</p>}
      {data.summary.startedRuns === 0 && <p className="notice" role="status">선택한 기간에 관찰된 시작 실행이 없어요. 도달 수는 0으로, 비율은 알 수 없음(—)으로 표시해요. 등록된 퍼널이 없는 것과는 달라요.</p>}
      <p className="context-note">다음 단계 미도달 수에는 아직 진행 중이거나 아직 전달되지 않은 실행이 포함돼요. 실패로 확정된 실행이 아니에요.</p>
      <FunnelJourney data={data} registry={registry} />
      <details className="goal-definition"><summary>단계별 수치 보기</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${data.definition.label} 단계별 도달 표`}>
        <table className="event-table funnel-table">
          <caption className="sr-only">{data.definition.label} 단계별 도달 수, 첫 단계 대비 도달률, 직전 단계 대비 전환율, 다음 단계 미도달 수</caption>
          <thead>{stepHead}</thead>
          <tbody>{stepRows(data.summary.steps, data.definition)}</tbody>
        </table>
      </div>
      <p className="context-note">첫 단계 도달률은 시작 실행 대비예요. 첫 단계의 직전 단계 전환율과 마지막 단계의 다음 미도달은 비교 대상이 없어 —로 표시해요.</p>
      </details>
      <details className="funnel-daily">
        <summary>일별 시작일 코호트 ({data.days.length}일)</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${data.definition.label} 일별 코호트 표`}>
          <table className="event-table funnel-table">
            <caption className="sr-only">시작일별 시작 실행·완료 실행 수, 완료율과 확정 상태</caption>
            <thead><tr>
              <th scope="col">시작일</th>
              <th scope="col" className="number-cell">시작 실행</th>
              <th scope="col" className="number-cell">완료 실행</th>
              <th scope="col" className="number-cell">완료율</th>
              <th scope="col">확정 상태</th>
            </tr></thead>
            <tbody>{data.days.map(day => <tr key={day.date}>
              <th scope="row"><button className="text-button funnel-day" type="button" aria-pressed={selectedDay === day.date} onClick={() => setSelectedDay(previous => previous === day.date ? null : day.date)}>{day.date}</button></th>
              <td className="number-cell">{formatCount(day.startedRuns)}</td>
              <td className="number-cell">{formatCount(day.completedRuns)}</td>
              <td className="number-cell">{formatRate(day.completionRate)}</td>
              <td>{day.provisional ? <span className="funnel-provisional">집계 중</span> : '확정'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="context-note">시작일 코호트가 끝난 뒤 48시간 동안은 집계 중이에요. 날짜를 선택하면 그 날의 단계별 내역을 볼 수 있어요.</p>
        {activeDay && <>
          <h4 className="funnel-day-heading">{activeDay.date} 단계별 내역{activeDay.provisional ? ' · 집계 중' : ''}</h4>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`${activeDay.date} 단계별 도달 표`}>
            <table className="event-table funnel-table">
              <caption className="sr-only">{activeDay.date} 시작일 코호트의 단계별 도달 수와 비율</caption>
              <thead>{stepHead}</thead>
              <tbody>{stepRows(activeDay.steps, data.definition)}</tbody>
            </table>
          </div>
        </>}
      </details>
      <FunnelBreakdown client={client} registry={registry} current={data} context={context} groupBy={groupBy} onState={breakdownChanged}
        compare={compare} previous={previous} comparisonError={comparisonError} comparisonContext={breakdownComparisonKey} onPreviousState={previousBreakdownChanged}
        onSelect={value => { setGrouping({ context, funnelId: selectedId, value }); setBreakdownSnapshot(null); setCsvMessage(null); }} />
    </>}
    {selectedId && <div className="csv-export funnel-csv">
      <button className="secondary-button" type="button" disabled={!csvReady} onClick={download} aria-describedby={`${id}-csv-status`}>퍼널 CSV 내려받기</button>
      <p id={`${id}-csv-status`} className={csvError ? 'form-error' : 'context-note'} role={csvError ? 'alert' : 'status'}>
        {csvReady ? csvMessage ?? (compare ? '현재·직전 기간 수치와 비교 지표를 CSV로 내려받아요.' : '현재 퍼널의 요약·단계·일별 수치를 CSV로 내려받아요.')
          : groupBy && (!breakdownData || compare && !previousBreakdownData) ? '분류 조회와 비교를 마치거나 분류를 해제하면 CSV를 내려받을 수 있어요.'
          : compare && data ? '퍼널 비교를 마치거나 비교를 끄면 CSV를 내려받을 수 있어요.' : '조회를 마치면 현재 퍼널 결과를 CSV로 내려받을 수 있어요.'}
      </p>
    </div>}
  </section>;
}
