import { useEffect, useId, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import type { Registry } from './api/types';
import type { FunnelResponse } from './api/funnel-contract';
import { FunnelBreakdownReport, type FunnelBreakdownState } from './api/funnel-breakdown';
import { formatCount, formatRate } from './data';
import { sourceLabel } from './SourceEventTable';

export default function FunnelBreakdown({ client, registry, current, context, groupBy, onSelect, onState }: {
  client: ApiClient; registry: Registry; current: FunnelResponse; context: string; groupBy: string;
  onSelect: (value: string) => void; onState: (state: FunnelBreakdownState) => void;
}) {
  const id = useId(), ref = useRef<FunnelBreakdownReport | null>(null);
  const [snapshot, setSnapshot] = useState<{ current: FunnelResponse; client: ApiClient; state: FunnelBreakdownState } | null>(null);
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
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
  const active = data?.buckets.find(bucket => JSON.stringify([typeof bucket.value, bucket.value]) === selection);
  const first = current.definition.steps[0]!;
  const event = registry.events.find(event => event.name === first.eventName && event.source === first.source);
  const label = (value: string | number | boolean) => typeof value === 'boolean' ? value ? 'true' : 'false' : String(value);
  if (!current.definition.dimensions.length) return null;
  return <section className="table-section">
    <h3>퍼널 속성별 분류</h3>
    <label className="api-field property-grouping" htmlFor={`${id}-property`}><span>퍼널 분류 기준</span>
      <select id={`${id}-property`} className="text-input settings-select" value={groupBy} onChange={event => onSelect(event.target.value)}>
        <option value="">분류 안 함</option>{current.definition.dimensions.map(name => <option key={name} value={name}>{name} · {event?.properties[name]?.purpose ?? name}</option>)}
      </select>
    </label>
    {!groupBy && <p className="context-note">등록된 시작일 분류를 선택하면 값별로 조회해요. 선택 전에는 추가 조회하지 않아요.</p>}
    {groupBy && (!state || state.phase === 'loading') && <p role="status" aria-busy="true">퍼널 분류를 조회하는 중이에요.</p>}
    {groupBy && state?.phase === 'error' && <div role="alert"><p>퍼널 분류를 불러오지 못했어요. 전체 결과는 유지돼요.</p>
      <button className="secondary-button" type="button" onClick={() => setRetry(value => value + 1)}>퍼널 분류 다시 시도</button></div>}
    {data && <>
      <p className="context-note">{data.groupBy} · 시작일 기준 · {data.meta.from} ~ {data.meta.to} · {data.meta.timeZone}. 분류 표는 현재 기간만 보여줘요.</p>
      {data.buckets.length === 0 ? <p role="status">선택한 분류에서 관측된 값이 없어요.</p> : <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="퍼널 속성값별 완료율 표"><table className="event-table funnel-table">
          <caption className="sr-only">{data.groupBy} 값별 시작·완료 실행 수와 완료율</caption>
          <thead><tr><th scope="col">속성 값</th><th scope="col" className="number-cell">시작</th><th scope="col" className="number-cell">완료</th><th scope="col" className="number-cell">완료율</th></tr></thead>
          <tbody>{data.buckets.map(bucket => { const key = JSON.stringify([typeof bucket.value, bucket.value]); return <tr key={key}>
            <th scope="row"><button type="button" className="text-button" aria-pressed={key === selection} onClick={() => setSelection(previous => previous === key ? null : key)}>{label(bucket.value)}</button></th>
            <td className="number-cell">{formatCount(bucket.summary.startedRuns)}</td><td className="number-cell">{formatCount(bucket.summary.completedRuns)}</td>
            <td className="number-cell">{formatRate(bucket.summary.completionRate)}</td></tr>; })}</tbody>
        </table></div><p className="context-note">값을 선택하면 단계별 수치와 일별 내역을 볼 수 있어요. 전체 표와 조회 시각이 달라 합계가 다를 수 있어요. 좁은 화면에서는 표를 옆으로 밀어 볼 수 있어요.</p>
      </>}
      {data.buckets.some(bucket => bucket.days.some(day => day.provisional)) && <p className="notice" role="status">집계 중인 시작일이 포함돼 분류 결과가 바뀔 수 있어요.</p>}
      {active && <>
        <h4>{label(active.value)} 단계별 내역</h4>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="선택한 속성값의 퍼널 단계 표"><table className="event-table funnel-table">
          <caption className="sr-only">선택한 속성값의 단계별 도달 수와 비율</caption>
          <thead><tr><th scope="col">단계·이벤트</th><th scope="col">출처</th><th scope="col" className="number-cell">도달</th><th scope="col" className="number-cell">첫 단계 대비 도달률</th><th scope="col" className="number-cell">직전 단계 대비 전환율</th></tr></thead>
          <tbody>{active.summary.steps.map(step => <tr key={step.stepIndex}><th scope="row">{step.stepIndex + 1}단계 · {data.definition.steps[step.stepIndex]!.eventName}</th>
            <td>{sourceLabel(data.definition.steps[step.stepIndex]!.source)}</td><td className="number-cell">{formatCount(step.reachedRuns)}</td><td className="number-cell">{formatRate(step.reachRate)}</td><td className="number-cell">{formatRate(step.conversionRate)}</td></tr>)}</tbody>
        </table></div>
        <details><summary>{label(active.value)} 일별 내역 ({active.days.length}일)</summary>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="선택한 속성값의 일별 퍼널 표"><table className="event-table funnel-table">
            <caption className="sr-only">선택한 속성값의 시작일별 실행 수와 완료율</caption>
            <thead><tr><th scope="col">시작일</th><th scope="col" className="number-cell">시작</th><th scope="col" className="number-cell">완료</th><th scope="col" className="number-cell">완료율</th><th scope="col">확정 상태</th></tr></thead>
            <tbody>{active.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td className="number-cell">{formatCount(day.startedRuns)}</td><td className="number-cell">{formatCount(day.completedRuns)}</td><td className="number-cell">{formatRate(day.completionRate)}</td><td>{day.provisional ? '집계 중' : '확정'}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </>}
  </section>;
}
