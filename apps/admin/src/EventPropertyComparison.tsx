import { useId } from 'react';
import type { EventPropertyComparison as Analysis } from './api/event-property-comparison';
import type { EventSeriesResponse } from './api/types';
import { rangeLabel } from './api/dates';
import { formatCount, formatRate } from './data';

function difference(value: number | null, unit: string): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}${unit}`;
}

export default function EventPropertyComparison({ current, previous, analysis }: { current: EventSeriesResponse; previous: EventSeriesResponse; analysis: Analysis }) {
  const id = useId();
  return <section className="property-analysis" aria-labelledby={id}>
    <h2 id={id}>{current.groupBy} 값별 직전 기간 비교</h2>
    <p className="context-note">현재 {rangeLabel(current.meta.from, current.meta.to)} · 이전 {rangeLabel(previous.meta.from, previous.meta.to)}</p>
    {analysis.rows.length === 0 ? <p role="status">두 기간에 관찰된 속성 값이 없어요.</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label="이벤트 속성별 직전 기간 비교 표"><table className="event-table">
        <caption className="sr-only">{current.eventName}의 {current.groupBy} 값별 현재·이전 건수와 비중 비교</caption>
        <thead><tr><th scope="col">{current.groupBy} 값</th><th scope="col" className="number-cell">건수<br />현재 / 이전</th><th scope="col" className="number-cell">건수 증감률</th><th scope="col" className="number-cell">비중<br />현재 / 이전</th><th scope="col" className="number-cell">비중 변화</th></tr></thead>
        <tbody>{analysis.rows.map(row => <tr key={row.key}><th scope="row">{row.value === null ? '값 없음' : row.value === true ? '참 (true)' : row.value === false ? '거짓 (false)' : String(row.value)}</th>
          <td className="number-cell">{formatCount(row.currentCount)} / {formatCount(row.previousCount)}</td><td className="number-cell">{difference(row.countChange, '%')}</td>
          <td className="number-cell">{formatRate(row.currentShare)} / {formatRate(row.previousShare)}</td><td className="number-cell">{difference(row.shareChange, '%p')}</td></tr>)}</tbody>
      </table></div>
      <p className="context-note">비중은 이 이벤트 전체 건수 대비 값별 건수이고 전환율이 아니에요. 이전 건수가 0이면 증감률은 —예요. 한 기간의 전체 건수가 0이면 비중과 그 변화도 —예요. 관찰되지 않은 값의 건수는 0으로 표시해요.</p>
    </>}
  </section>;
}
