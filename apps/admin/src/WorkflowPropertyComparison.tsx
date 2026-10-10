import type { Registry, WorkflowBreakdownResponse } from './api/types';
import { compareWorkflowProperties, workflowValueLabel } from './api/workflow-analysis';
import { rangeLabel } from './api/dates';
import { formatCount, formatRate } from './data';

export default function WorkflowPropertyComparison({ current, previous, registry }: {
  current: WorkflowBreakdownResponse; previous: WorkflowBreakdownResponse; registry: Registry;
}) {
  const rows = compareWorkflowProperties(current, previous, registry);
  const delta = (value: number | null) => {
    if (value === null) return '—';
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}%p`;
  };
  return <>
    <h4>속성별 직전 기간 비교</h4>
    <p className="context-note">현재 {rangeLabel(current.meta.from, current.meta.to)} · 이전 {rangeLabel(previous.meta.from, previous.meta.to)}</p>
    {rows.length === 0 ? <p role="status">두 기간에 관찰된 속성 값이 없어요.</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label="속성별 직전 기간 비교 표"><table className="event-table">
        <caption className="sr-only">{current.groupBy} 값별 현재·이전 기간의 시작·성공·완료율 비교</caption>
        <thead><tr><th scope="col">{current.groupBy} 값</th><th scope="col" className="number-cell">시작<br />현재 / 이전</th><th scope="col" className="number-cell">성공<br />현재 / 이전</th><th scope="col" className="number-cell">완료율<br />현재 / 이전</th><th scope="col" className="number-cell">완료율 변화</th></tr></thead>
        <tbody>{rows.map(row => <tr key={JSON.stringify(row.value)}><th scope="row">{workflowValueLabel(row.value)}</th>
          <td className="number-cell">{formatCount(row.current.startedAttempts)} / {formatCount(row.previous.startedAttempts)}</td>
          <td className="number-cell">{formatCount(row.current.succeededAttempts)} / {formatCount(row.previous.succeededAttempts)}</td>
          <td className="number-cell">{formatRate(row.current.completionRate)} / {formatRate(row.previous.completionRate)}</td>
          <td className="number-cell">{delta(row.rateDifference)}</td></tr>)}</tbody>
      </table></div>
      <p className="context-note">각 칸은 현재 / 이전 순서예요. 관찰되지 않은 값의 건수는 0이고, 시작이 0인 기간의 완료율과 그 비교는 —예요. 완료율 변화는 %p예요.
        {rows.some(row => row.provisional) && ' 아직 집계 중인 시작일이 포함돼 완료율이 바뀔 수 있어요.'}</p>
    </>}
  </>;
}
