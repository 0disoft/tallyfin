import type { ReactNode } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { formatCount } from './data';
import { countChange } from './api/period-comparison';
import { rangeLabel } from './api/dates';
import type { EventRow } from './api/dashboard-model';
import type { EventSource, SummaryResponse } from './api/types';
import './event-shell.css';
import './event-workspace.css';

type Props = {
  rows: EventRow[]; filtered: EventRow[]; source: EventSource; query: string;
  selectedEvent: string | null; compare: boolean; previous: SummaryResponse | null;
  onQuery: (query: string) => void; onSource: (source: EventSource) => void;
  onSelect: (name: string) => void; children: ReactNode;
};

function changeLabel(current: number | null, previous: number | null) {
  const change = countChange(current, previous);
  return change === null ? previous === 0 ? '이전 0건 · —' : '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

export default function EventWorkspace({ rows, filtered, source, query, selectedEvent, compare, previous, onQuery, onSource, onSelect, children }: Props) {
  const scoped = rows.filter(row => row.source === source);
  const visible = filtered.filter(row => row.source === source);
  const selected = scoped.find(row => row.definition.name === selectedEvent);
  const total = scoped.every(row => row.count !== null) ? scoped.reduce((sum, row) => sum + row.count!, 0) : null;
  const before = new Map(previous?.events.map(event => [event.name, event.count]));
  const barMaximum = Math.max(1, ...scoped.map(row => row.count ?? 0), ...(previous?.events.map(event => event.count) ?? []));
  const empty = visible.length === 0 && <div className="state-panel" role="status"><h2>{query.trim() ? '검색 결과가 없어요' : '이 출처에 등록된 이벤트가 없어요'}</h2>{query.trim() && <button className="secondary-button" type="button" onClick={() => onQuery('')}>검색 초기화</button>}</div>;
  const controls = <>
    <label className="search-control"><MagnifyingGlass size={18} /><span className="sr-only">이벤트 검색</span>
      <input type="search" placeholder="이벤트 이름 또는 키 검색" value={query} onChange={event => onQuery(event.target.value)} /></label>
    <div className="event-source-switch" role="group" aria-label="발행 출처">
      {(['browser', 'server'] as const).map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => onSource(value)}>{value === 'browser' ? '브라우저' : '서버'}</button>)}
    </div>
  </>;
  return <div className={`event-workspace${compare ? ' is-comparing' : ''}`}>
    {compare ? <section aria-label="이벤트 기간 비교">
      <div className="event-comparison-header"><h2>이벤트 기간 비교</h2>{controls}</div>
      {previous && <p className="context-note">이전 {rangeLabel(previous.meta.from, previous.meta.to)} · {previous.meta.timeZone}</p>}
      <div className="event-comparison-summary"><span>현재 이벤트 <strong>{total === null ? '—' : formatCount(total)}</strong></span>
        <span>이전 이벤트 <strong>{previous ? formatCount(previous.totalEvents) : '—'}</strong></span>
        <span>증감 <strong>{changeLabel(total, previous?.totalEvents ?? null)}</strong></span></div>
      <div className="table-scroll" tabIndex={0} aria-label="이벤트 기간 비교 표"><table className="event-table event-comparison-table">
        <thead><tr><th scope="col">이벤트</th><th scope="col" className="number-cell">현재</th><th scope="col" className="number-cell">이전</th><th scope="col" className="number-cell">차이</th><th scope="col" className="number-cell">증감</th><th scope="col">현재 / 이전</th></tr></thead>
        <tbody>{visible.map(row => {
          const previousCount = before.get(row.definition.name) ?? null;
          const delta = row.count === null || previousCount === null ? null : row.count - previousCount;
          return <tr key={row.definition.name} aria-selected={selectedEvent === row.definition.name}>
            <th scope="row"><button className="text-button event-comparison-name" type="button" aria-label={row.definition.name} aria-pressed={selectedEvent === row.definition.name} onClick={() => onSelect(row.definition.name)}>{row.definition.label}<small>{row.definition.name}</small></button></th>
            <td className="number-cell">{row.count === null ? '—' : formatCount(row.count)}</td><td className="number-cell">{previousCount === null ? '—' : formatCount(previousCount)}</td>
            <td className="number-cell" data-change={delta === null || delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down'}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatCount(delta)}`}</td><td className="number-cell" data-change={delta === null || delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down'}>{changeLabel(row.count, previousCount)}</td>
            <td><div className="event-comparison-bars">{row.count !== null && <meter min={0} max={barMaximum} value={row.count} aria-label={`${row.definition.label} 현재 건수`} />}{previousCount !== null && <meter min={0} max={barMaximum} value={previousCount} aria-label={`${row.definition.label} 이전 건수`} />}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {empty}
    </section> : <aside className="event-explorer" aria-label="이벤트 탐색기">
      <div className="event-explorer-heading"><h2>이벤트 탐색기</h2></div>{controls}
      <p className="event-explorer-count">등록 이벤트 {scoped.length}개{query.trim() && ` · 검색 ${visible.length}개`}</p>
      <div className="event-explorer-list">{visible.map(row => <button key={row.definition.name} type="button" className="event-explorer-item" aria-label={row.definition.name} aria-pressed={selectedEvent === row.definition.name} onClick={() => onSelect(row.definition.name)}>
        <span className="event-explorer-label"><strong>{row.definition.label}</strong><small>{row.definition.name}</small></span>
        <strong className="event-explorer-value">{row.count === null ? '—' : formatCount(row.count)}</strong>
      </button>)}</div>
      {empty}
      <footer className="event-explorer-total"><span>전체 이벤트 합계</span><strong>{total === null ? '—' : formatCount(total)}</strong></footer>
    </aside>}
    <section className="event-inspector" aria-label="선택 이벤트 상세">
      {selected ? <div className="event-inspector-heading"><div><small>이벤트 / {selected.definition.name}</small><h2>{selected.definition.label}</h2></div>
        <div className="event-inspector-count"><strong>{selected.count === null ? '—' : formatCount(selected.count)}<span>건</span></strong><span>선택 기간 합계</span></div></div>
        : <div className="state-panel"><h2>이벤트를 선택하세요</h2><p>목록에서 이벤트를 고르면 일별 추이와 속성별 건수를 확인할 수 있어요.</p></div>}
      <div className="event-inspector-body">{children}</div>
    </section>
  </div>;
}
