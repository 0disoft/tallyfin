import { compareFunnelBreakdowns, funnelValueKey } from './api/funnel-breakdown-comparison';
import type { FunnelBreakdown } from './api/funnel-breakdown';
import { formatCount, formatRate } from './data';

export default function FunnelBreakdownComparison({ current, previous, selection, onSelect }: {
  current: FunnelBreakdown; previous: FunnelBreakdown; selection: string | null; onSelect: (key: string) => void;
}) {
  const buckets = compareFunnelBreakdowns(current, previous);
  const active = buckets.find(bucket => funnelValueKey(bucket.value) === selection);
  const change = (value: number | null, unit: string) => {
    if (value === null) return '—';
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}${unit}`;
  };
  return <section className="table-section">
    <h4>속성별 퍼널 직전 기간 비교</h4>
    <p className="context-note">현재 {current.meta.from} ~ {current.meta.to} · 이전 {previous.meta.from} ~ {previous.meta.to} · {current.meta.timeZone}</p>
    {!buckets.length ? <p role="status">두 기간 모두 선택한 분류에서 관측된 값이 없어요.</p> : <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="속성별 퍼널 직전 기간 비교 표"><table className="event-table funnel-table">
        <caption className="sr-only">같은 속성값의 현재·직전 기간 시작 건수와 완료율 차이</caption>
        <thead><tr><th scope="col">속성 값</th><th scope="col" className="number-cell">현재 시작</th><th scope="col" className="number-cell">이전 시작</th>
          <th scope="col" className="number-cell">현재 완료율</th><th scope="col" className="number-cell">이전 완료율</th><th scope="col" className="number-cell">완료율 차이</th></tr></thead>
        <tbody>{buckets.map(bucket => { const key = funnelValueKey(bucket.value); return <tr key={key}>
          <th scope="row"><button className="text-button" type="button" aria-pressed={selection === key} onClick={() => onSelect(key)}>{String(bucket.value)}</button></th>
          <td className="number-cell">{formatCount(bucket.current.startedRuns)}</td><td className="number-cell">{formatCount(bucket.previous.startedRuns)}</td>
          <td className="number-cell">{formatRate(bucket.current.completionRate)}</td><td className="number-cell">{formatRate(bucket.previous.completionRate)}</td>
          <td className="number-cell">{change(bucket.rows.find(row => row.key === 'completion')!.change, '%p')}</td></tr>; })}</tbody>
      </table></div>
      <p className="context-note">한쪽 기간에만 나온 값도 보여줘요. 관측된 시작이 없으면 건수는 0, 비율은 —예요. 값을 선택하면 완료 건수·단계별 변화도 볼 수 있어요.</p>
    </>}
    {active && <>
      <h4>{String(active.value)} 단계별 기간 비교</h4>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="선택 속성값의 단계별 기간 비교 표"><table className="event-table funnel-table">
        <caption className="sr-only">선택 속성값의 시작·완료·단계별 도달과 비율 변화</caption>
        <thead><tr><th scope="col">지표</th><th scope="col" className="number-cell">현재</th><th scope="col" className="number-cell">이전</th><th scope="col" className="number-cell">변화</th></tr></thead>
        <tbody>{active.rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th>
          <td className="number-cell">{row.rate ? formatRate(row.current) : row.current === null ? '—' : formatCount(row.current)}</td>
          <td className="number-cell">{row.rate ? formatRate(row.previous) : row.previous === null ? '—' : formatCount(row.previous)}</td>
          <td className="number-cell">{change(row.change, row.unit)}</td></tr>)}</tbody>
      </table></div>
    </>}
    <p className="context-note">건수는 이전 대비 증감률(%), 비율은 차이(%p)예요. 이전 0건의 증감률과 분모 없는 비율 차이는 —로 표시해요. 수신된 실행만 비교하며 표는 옆으로 밀어 볼 수 있어요.</p>
    {[current, previous].some(report => report.buckets.some(bucket => bucket.days.some(day => day.provisional))) &&
      <p className="notice" role="status">두 기간 중 집계 중인 시작일이 있어 분류 비교 결과가 달라질 수 있어요.</p>}
  </section>;
}
