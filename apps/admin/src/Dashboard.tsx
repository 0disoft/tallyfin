import { useEffect, useState, type ComponentType } from 'react';
import type { TrendChartProps } from './TrendChart';
import { ArrowDown, ArrowRight, ArrowUp, ChartBar, Circle, MagnifyingGlass } from '@phosphor-icons/react';
import { formatCount, formatRate, getSeries, type DailyRecord, type ProjectDefinition, type Summary } from './data';

type Props = { project: ProjectDefinition; records: DailyRecord[]; summary: Summary };
export function Trend({ records, event, kind }: { records: DailyRecord[]; event?: string; kind?: TrendChartProps['kind'] }) {
  const series = getSeries(records, event);
  const [Chart, setChart] = useState<ComponentType<TrendChartProps> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    import('./TrendChart').then(module => {
      if (active) setChart(() => module.default);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, []);
  return <figure className="trend-figure">
    <figcaption className="sr-only">일별 {event ?? '수집 이벤트'} 건수. 아래 수치 보기에서 표로 확인할 수 있어요.</figcaption>
    {Chart ? <Chart series={series} kind={kind} /> : <div className="chart-wrap chart-placeholder" aria-busy={!loadFailed}>
      {loadFailed ? <><p role="status">차트를 불러오지 못했어요. 아래 수치 보기에서 확인하거나 화면을 새로고침해 주세요.</p><button type="button" className="secondary-button" onClick={() => window.location.reload()}>화면 새로고침</button></> : <p role="status">차트를 불러오는 중이에요.</p>}
    </div>}
    <details className="daily-values"><summary>수치 보기</summary><div className="table-scroll" tabIndex={0} aria-label="일별 수치 표"><table className="event-table"><caption className="sr-only">일별 수집 건수</caption><thead><tr><th scope="col">날짜</th><th scope="col" className="number-cell">건수</th></tr></thead><tbody>{series.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td className="number-cell">{formatCount(day.count)}</td></tr>)}</tbody></table></div></details>
  </figure>;
}
export function Overview({ project, records, summary, onAnalyze }: Props & { onAnalyze: () => void }) {
  const metrics = [['수집 이벤트', formatCount(summary.total)], [project.startLabel, formatCount(summary.started)], [project.successLabel, formatCount(summary.succeeded)], ['완료율', formatRate(summary.rate)]];
  return <>
    <section className="metric-grid" aria-label="주요 지표">{metrics.map(([label, value], i) => <div className="metric" key={label}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{i === 3 && <div className="metric-detail">{formatCount(summary.succeeded)} / {formatCount(summary.started)}</div>}</div>)}</section>
    <section className="trend-section"><div className="section-header"><h2>일별 수집 이벤트 추이</h2><button type="button" className="primary-button" onClick={onAnalyze}><ChartBar size={22} weight="fill" />이벤트 분석으로 이동</button></div><div className="legend"><Circle size={12} weight="fill" color="#155EEF" />수집 이벤트</div><Trend records={records} /></section>
    <section className="table-section"><h2>이벤트별 집계</h2><div className="table-scroll" tabIndex={0} aria-label="주요 이벤트 집계"><table className="event-table"><caption className="sr-only">주요 등록 이벤트 4종. 전체 건수에는 화면 조회 이벤트도 포함해요.</caption><thead><tr><th scope="col">이벤트</th><th scope="col" className="number-cell">건수</th></tr></thead><tbody>{summary.events.slice(0, 4).map(event => <tr key={event.definition.name}><th scope="row" className="event-name">{event.definition.name}</th><td className="number-cell">{formatCount(event.count)}</td></tr>)}</tbody></table></div></section>
  </>;
}
export function EventAnalysis({ project, records, summary }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'count'>('count');
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const events = summary.events.filter(event => `${event.definition.name} ${event.definition.label}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => (sort === 'count' ? a.count - b.count : a.definition.name.localeCompare(b.definition.name)) * (descending ? -1 : 1));
  const detail = project.events.find(event => event.name === selected);
  function changeSort(next: 'name' | 'count') { if (sort === next) setDescending(!descending); else { setSort(next); setDescending(next === 'count'); } }
  return <>
    <div className="toolbar"><label className="search-control"><MagnifyingGlass size={20} /><span className="sr-only">이벤트 검색</span><input type="search" placeholder="이벤트 이름 검색" value={query} onChange={event => setQuery(event.target.value)} /></label><span className="context-note">스키마 v{project.version} · {summary.events.length}개 등록 이벤트</span></div>
    <div className="table-scroll" tabIndex={0} aria-label="등록 이벤트 표"><table className="event-table"><caption className="sr-only">선택 기간의 등록 이벤트 건수</caption><thead><tr><th scope="col" aria-sort={sort === 'name' ? descending ? 'descending' : 'ascending' : 'none'}><button className="sort-button" onClick={() => changeSort('name')}>이벤트 {sort === 'name' && (descending ? <ArrowDown size={18} /> : <ArrowUp size={18} />)}</button></th><th scope="col">발행 출처</th><th scope="col" className="number-cell" aria-sort={sort === 'count' ? descending ? 'descending' : 'ascending' : 'none'}><button className="sort-button" onClick={() => changeSort('count')}>건수 {sort === 'count' && (descending ? <ArrowDown size={18} /> : <ArrowUp size={18} />)}</button></th></tr></thead><tbody>{events.map(event => <tr key={event.definition.name}><th scope="row"><button className="text-button event-name" aria-pressed={selected === event.definition.name} onClick={() => setSelected(event.definition.name)}>{event.definition.name}<ArrowRight size={16} /></button><div className="event-label">{event.definition.label}</div></th><td>{event.definition.source}</td><td className="number-cell">{formatCount(event.count)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>표시된 이벤트 합계</th><td className="number-cell">{formatCount(events.reduce((total, event) => total + event.count, 0))}</td></tr></tfoot></table></div>
    {events.length === 0 && <div className="state-panel" role="status"><h2>검색 결과가 없어요</h2><button className="secondary-button" onClick={() => setQuery('')}>검색 초기화</button></div>}
    {detail && <section className="event-detail"><div className="section-header"><h2>{detail.label}</h2><button className="text-button" onClick={() => setSelected(null)}>상세 닫기</button></div><p className="context-note">{detail.name} · {detail.source} · 스키마 v{project.version}</p><p>허용 속성: {detail.properties.join(', ')}</p><Trend records={records} event={detail.name} /></section>}
  </>;
}
export function Goals({ project, summary }: Props) {
  return <section className="goal-section"><div className="goal-header"><div><h2>{project.goal}</h2><p className="context-note">같은 작업 흐름에서 시작한 시도 중 완료한 비율</p></div><div className="goal-ratio"><strong>{formatRate(summary.rate)}</strong><span>{formatCount(summary.succeeded)} / {formatCount(summary.started)}</span></div></div>
    {summary.rate !== null && <progress className="goal-track" max={100} value={summary.rate} aria-label={`${project.goal} 완료율`} />}
    <dl className="definition-list"><div><dt>시작</dt><dd>{project.events[0].name}<span>{formatCount(summary.started)}건</span></dd></div><div><dt>성공</dt><dd>{project.events[1].name}<span>{formatCount(summary.succeeded)}건</span></dd></div><div><dt>오류</dt><dd>{project.events[2].name}<span>{formatCount(summary.failed)}건</span></dd></div><div><dt>집계 기준</dt><dd>브라우저 메모리 작업 흐름 · 정의 v{project.version}</dd></div></dl><p className="context-note">오류는 성공하지 못한 모든 시도의 수와 같지 않아요. 이 샘플은 새로고침이나 기기를 가로질러 방문자를 연결하지 않아요.</p>
  </section>;
}
