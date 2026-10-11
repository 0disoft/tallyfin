import { compareFunnels } from './api/funnel-comparison';
import type { FunnelResponse } from './api/funnel-contract';
import { formatCount, formatRate } from './data';
import { rangeLabel } from './api/dates';

export default function FunnelComparison({ current, previous }: { current: FunnelResponse; previous: FunnelResponse }) {
  const rows = compareFunnels(current, previous);
  const provisional = [current, previous].some(response => response.days.some(day => day.provisional));
  const value = (number: number | null, rate: boolean) => rate ? formatRate(number) : number === null ? '—' : formatCount(number);
  const change = (number: number | null, unit: string) => {
    if (number === null) return '—';
    const rounded = Math.round(number * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}${unit}`;
  };
  return <section className="table-section">
    <h3>퍼널 직전 기간 비교</h3>
    <p className="context-note">현재 {rangeLabel(current.meta.from, current.meta.to)} · 이전 {rangeLabel(previous.meta.from, previous.meta.to)}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="퍼널 직전 기간 비교 표">
      <table className="event-table funnel-table">
        <caption className="sr-only">{current.definition.label} 같은 정의의 현재·직전 시작일 코호트 비교</caption>
        <thead><tr><th scope="col">지표</th><th scope="col" className="number-cell">현재</th><th scope="col" className="number-cell">이전</th><th scope="col" className="number-cell">변화</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th>
          <td className="number-cell">{value(row.current, row.rate)}</td><td className="number-cell">{value(row.previous, row.rate)}</td>
          <td className="number-cell">{change(row.change, row.unit)}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="context-note">건수는 이전 대비 증감률(%), 비율은 차이(%p)예요. 이전 0건의 증감률과 분모 없는 비율 차이는 —로 표시해요. 수신된 실행만 비교해요. 좁은 화면에서는 표를 옆으로 밀어 볼 수 있어요.</p>
    {provisional && <p className="notice" role="status">두 기간 중 집계 중인 시작일이 있어 비교 결과가 달라질 수 있어요.</p>}
  </section>;
}
