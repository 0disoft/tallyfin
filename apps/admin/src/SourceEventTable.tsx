import { ArrowRight } from '@phosphor-icons/react';
import { formatCount } from './data';
import type { EventSource } from './api/types';
import type { EventRow } from './api/dashboard-model';
export type { EventRow } from './api/dashboard-model';

export const sourceLabel = (source: EventSource) => source === 'server' ? '서버' : '브라우저';
export default function SourceEventTable({ rows, source, selectedEvent, onSelect, total = false }: {
  rows: EventRow[]; source: EventSource; selectedEvent?: string | null; onSelect?: (name: string) => void; total?: boolean;
}) {
  return <div className="table-scroll" tabIndex={0} aria-label="등록 이벤트 집계"><table className="event-table">
    <caption className="sr-only">선택 기간의 {sourceLabel(source)} 이벤트 수신 건수</caption>
    <thead><tr><th scope="col">이벤트</th><th scope="col">발행 출처</th><th scope="col" className="number-cell">건수</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.definition.name}>
      <th scope="row">{onSelect && row.source === source
        ? <button className="text-button event-name" type="button" aria-pressed={selectedEvent === row.definition.name}
          onClick={() => onSelect(row.definition.name)}>{row.definition.name}<ArrowRight size={16} /></button>
        : <span className="event-name">{row.definition.name}</span>}<div className="event-label">{row.definition.label}</div></th>
      <td>{row.source ? sourceLabel(row.source) : '—'}</td>
      <td className="number-cell">{row.count !== null ? formatCount(row.count) : row.source !== source ? '다른 출처' : '—'}</td>
    </tr>)}</tbody>
    {total && <tfoot><tr><th scope="row" colSpan={2}>표시된 {sourceLabel(source)} 이벤트 합계</th>
      <td className="number-cell">{formatCount(rows.reduce((sum, row) => sum + (row.count ?? 0), 0))}</td></tr></tfoot>}
  </table></div>;
}
