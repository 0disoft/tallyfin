import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import { useEffect, useState, type ComponentType } from 'react';
import type { TrendChartProps } from './TrendChart';
import { ArrowDown, ArrowRight, ArrowUp, ChartBar, Circle, MagnifyingGlass } from '@phosphor-icons/react';
import { getSeries, type DailyRecord, type ProjectDefinition, type Summary } from './data';

type Props = { project: ProjectDefinition; records: DailyRecord[]; summary: Summary };
export function Trend({ records, event, kind }: { records: DailyRecord[]; event?: string; kind?: TrendChartProps['kind'] }) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
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
    <figcaption className="sr-only">{t('admin:chartDescription', { event: event ?? t('admin:collectedEvents') })}</figcaption>
    {Chart ? <Chart series={series} kind={kind} /> : <div className="chart-wrap chart-placeholder" aria-busy={!loadFailed}>
      {loadFailed ? <><p role="status">{t('admin:chartLoadError')}</p><button type="button" className="secondary-button" onClick={() => window.location.reload()}>{t('admin:reloadPage')}</button></> : <p role="status">{t('admin:chartLoading')}</p>}
    </div>}
    <details className="daily-values"><summary>{t('admin:showValues')}</summary><div className="table-scroll" tabIndex={0} aria-label={t('admin:dailyValuesTable')}><table className="event-table"><caption className="sr-only">{t('admin:dailyCounts')}</caption><thead><tr><th scope="col">{t('admin:date')}</th><th scope="col" className="number-cell">{t('admin:count')}</th></tr></thead><tbody>{series.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td className="number-cell">{formatCount(day.count)}</td></tr>)}</tbody></table></div></details>
  </figure>;
}
export function Overview({ project, records, summary, onAnalyze }: Props & { onAnalyze: () => void }) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const metrics = [[t('sample:collectedEvents'), formatCount(summary.total)], [project.startLabel, formatCount(summary.started)], [project.successLabel, formatCount(summary.succeeded)], [t('sample:completionRate'), formatRate(summary.rate)]];
  return <>
    <section className="metric-grid" aria-label={t('sample:metricsAria')}>{metrics.map(([label, value], i) => <div className="metric" key={label}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{i === 3 && <div className="metric-detail">{formatCount(summary.succeeded)} / {formatCount(summary.started)}</div>}</div>)}</section>
    <section className="trend-section"><div className="section-header"><h2>{t('sample:dailyCollectedEvents')}</h2><button type="button" className="primary-button" onClick={onAnalyze}><ChartBar size={22} weight="fill" />{t('sample:goToEventAnalysis')}</button></div><div className="legend"><Circle size={12} weight="fill" color="#155EEF" />{t('sample:collectedEvents')}</div><Trend records={records} /></section>
    <section className="table-section"><h2>{t('sample:eventBreakdown')}</h2><div className="table-scroll" tabIndex={0} aria-label={t('sample:eventBreakdownAria')}><table className="event-table"><caption className="sr-only">{t('sample:eventBreakdownCaption')}</caption><thead><tr><th scope="col">{t('sample:event')}</th><th scope="col" className="number-cell">{t('sample:count')}</th></tr></thead><tbody>{summary.events.slice(0, 4).map(event => <tr key={event.definition.name}><th scope="row" className="event-name">{event.definition.name}</th><td className="number-cell">{formatCount(event.count)}</td></tr>)}</tbody></table></div></section>
  </>;
}
export function EventAnalysis({ project, records, summary }: Props) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'count'>('count');
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const events = summary.events.filter(event => `${event.definition.name} ${event.definition.label}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => (sort === 'count' ? a.count - b.count : a.definition.name.localeCompare(b.definition.name)) * (descending ? -1 : 1));
  const detail = project.events.find(event => event.name === selected);
  function changeSort(next: 'name' | 'count') { if (sort === next) setDescending(!descending); else { setSort(next); setDescending(next === 'count'); } }
  return <>
    <div className="toolbar"><label className="search-control"><MagnifyingGlass size={20} /><span className="sr-only">{t('sample:searchEvents')}</span><input type="search" placeholder={t('sample:searchEventsPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label><span className="context-note">{t('sample:schemaEventsMeta', { version: project.version, count: formatCount(summary.events.length) })}</span></div>
    <div className="table-scroll" tabIndex={0} aria-label={t('sample:registeredEventsAria')}><table className="event-table"><caption className="sr-only">{t('sample:registeredEventsCaption')}</caption><thead><tr><th scope="col" aria-sort={sort === 'name' ? descending ? 'descending' : 'ascending' : 'none'}><button className="sort-button" onClick={() => changeSort('name')}>{t('sample:event')} {sort === 'name' && (descending ? <ArrowDown size={18} /> : <ArrowUp size={18} />)}</button></th><th scope="col">{t('sample:sourceGroup')}</th><th scope="col" className="number-cell" aria-sort={sort === 'count' ? descending ? 'descending' : 'ascending' : 'none'}><button className="sort-button" onClick={() => changeSort('count')}>{t('sample:count')} {sort === 'count' && (descending ? <ArrowDown size={18} /> : <ArrowUp size={18} />)}</button></th></tr></thead><tbody>{events.map(event => <tr key={event.definition.name}><th scope="row"><button className="text-button event-name" aria-pressed={selected === event.definition.name} onClick={() => setSelected(event.definition.name)}>{event.definition.name}<ArrowRight size={16} /></button><div className="event-label">{event.definition.label}</div></th><td>{event.definition.source}</td><td className="number-cell">{formatCount(event.count)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>{t('sample:visibleEventsTotal')}</th><td className="number-cell">{formatCount(events.reduce((total, event) => total + event.count, 0))}</td></tr></tfoot></table></div>
    {events.length === 0 && <div className="state-panel" role="status"><h2>{t('sample:searchEmpty')}</h2><button className="secondary-button" onClick={() => setQuery('')}>{t('sample:clearSearch')}</button></div>}
    {detail && <section className="event-detail"><div className="section-header"><h2>{detail.label}</h2><button className="text-button" onClick={() => setSelected(null)}>{t('sample:closeDetail')}</button></div><p className="context-note">{t('sample:eventDetailMeta', { name: detail.name, source: detail.source, version: project.version })}</p><p>{t('sample:allowedProperties', { properties: detail.properties.join(', ') })}</p><Trend records={records} event={detail.name} /></section>}
  </>;
}
export function Goals({ project, summary }: Props) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  return <section className="goal-section"><div className="goal-header"><div><h2>{project.goal}</h2><p className="context-note">{t('sample:goalCompletionHelp')}</p></div><div className="goal-ratio"><strong>{formatRate(summary.rate)}</strong><span>{formatCount(summary.succeeded)} / {formatCount(summary.started)}</span></div></div>
    {summary.rate !== null && <progress className="goal-track" max={100} value={summary.rate} aria-label={t('sample:goalCompletionAria', { goal: project.goal })} />}
    <dl className="definition-list"><div><dt>{t('sample:start')}</dt><dd>{project.events[0].name}<span>{t('sample:goalCount', { count: formatCount(summary.started) })}</span></dd></div><div><dt>{t('sample:success')}</dt><dd>{project.events[1].name}<span>{t('sample:goalCount', { count: formatCount(summary.succeeded) })}</span></dd></div><div><dt>{t('sample:error')}</dt><dd>{project.events[2].name}<span>{t('sample:goalCount', { count: formatCount(summary.failed) })}</span></dd></div><div><dt>{t('sample:aggregationBasis')}</dt><dd>{t('sample:browserMemoryWorkflow', { version: project.version })}</dd></div></dl><p className="context-note">{t('sample:goalNote')}</p>
  </section>;
}
