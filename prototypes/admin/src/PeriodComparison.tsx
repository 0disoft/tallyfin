import { formatCount, formatRate, type View } from './data';
import { countChange, rateChange, type PeriodSnapshot } from './api/period-comparison';
import { rangeLabel } from './api/dates';

type Row = { key: string; label: string; current: number | null; previous: number | null; rate?: boolean };
function difference(row: Row): string {
  const change = row.rate ? rateChange(row.current, row.previous) : countChange(row.current, row.previous);
  if (change === null) return row.rate ? '완료율 비교 불가' : row.previous === 0 ? '이전 0건 · 증감률 계산 불가' : '비교 불가';
  const rounded = Math.round(change * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)}${row.rate ? '%p' : '%'}`;
}
export default function PeriodComparison({ current, previous, view }: { current: PeriodSnapshot; previous: PeriodSnapshot; view: View }) {
  const rows: Row[] = [{ key: 'total', label: '수집 이벤트', current: current.summary.totalEvents, previous: previous.summary.totalEvents }];
  if (view === 'events') {
    const before = new Map(previous.summary.events.map(event => [event.name, event.count]));
    rows.push(...current.summary.events.map(event => ({ key: `event:${event.name}`, label: event.name, current: event.count, previous: before.get(event.name) ?? null })));
  } else {
    const flows = view === 'overview' ? current.workflows.slice(0, 1) : current.workflows;
    for (const flow of flows) {
      const before = previous.workflows.find(item => item.definition.id === flow.definition.id)?.response.summary;
      for (const [key, label, rate] of [['startedAttempts', '시작', false], ['succeededAttempts', '성공', false], ['completionRate', '완료율', true]] as const)
        rows.push({ key: `${flow.definition.id}:${key}`, label: `${flow.definition.label} · ${label}`, current: flow.response.summary[key], previous: before?.[key] ?? null, rate });
    }
  }
  const provisional = [...current.workflows, ...previous.workflows].some(flow => flow.response.days.some(day => day.provisional));
  return <section className="table-section period-comparison" aria-labelledby="comparison-heading">
    <h2 id="comparison-heading">직전 기간 비교</h2>
    <p className="context-note">현재 {rangeLabel(current.range.from, current.range.to)} · 이전 {rangeLabel(previous.range.from, previous.range.to)}</p>
    <div className="table-scroll" tabIndex={0} aria-label="직전 기간 비교 표"><table className="event-table">
      <caption className="sr-only">같은 프로젝트·스키마 버전의 같은 길이 기간 비교</caption>
      <thead><tr><th scope="col">지표</th><th scope="col" className="number-cell">현재</th><th scope="col" className="number-cell">이전</th><th scope="col" className="number-cell">변화</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td className="number-cell">{row.rate ? formatRate(row.current) : row.current === null ? '—' : formatCount(row.current)}</td><td className="number-cell">{row.rate ? formatRate(row.previous) : row.previous === null ? '—' : formatCount(row.previous)}</td><td className="number-cell">{difference(row)}</td></tr>)}</tbody>
    </table></div>
    <p className="context-note">건수는 이전 기간 대비 증감률(%), 완료율은 차이(%p)예요. 수신된 데이터만 비교해요.{provisional && ' 아직 확정되지 않은 시작일 코호트가 포함돼 완료율이 바뀔 수 있어요.'}</p>
  </section>;
}
