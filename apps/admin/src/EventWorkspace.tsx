import type { ReactNode } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { countChange } from './api/period-comparison';
import { rangeLabel } from './api/dates';
import type { EventRow } from './api/dashboard-model';
import type { EventSource, SummaryResponse } from './api/types';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import EventSourceSwitch from './EventSourceSwitch';
import './event-shell.css';
import './event-workspace.css';

type Props = {
  rows: EventRow[]; filtered: EventRow[]; source: EventSource; query: string;
  selectedEvent: string | null; compare: boolean; previous: SummaryResponse | null;
  onQuery: (query: string) => void; onSource: (source: EventSource) => void;
  onSelect: (name: string) => void; children: ReactNode;
};

export default function EventWorkspace({ rows, filtered, source, query, selectedEvent, compare, previous, onQuery, onSource, onSelect, children }: Props) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  const changeLabel = (current: number | null, before: number | null) => {
    const change = countChange(current, before);
    return change === null ? before === 0 ? t('analysis:previousZeroDash') : '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
  };
  const scoped = rows.filter(row => row.source === source);
  const visible = filtered.filter(row => row.source === source);
  const selected = scoped.find(row => row.definition.name === selectedEvent);
  const total = scoped.every(row => row.count !== null) ? scoped.reduce((sum, row) => sum + row.count!, 0) : null;
  const before = new Map(previous?.events.map(event => [event.name, event.count]));
  const barMaximum = Math.max(1, ...scoped.map(row => row.count ?? 0), ...(previous?.events.map(event => event.count) ?? []));
  const empty = visible.length === 0 && <div className="state-panel" role="status"><h2>{query.trim() ? t('analysis:searchEmptyTitle') : t('analysis:sourceEmptyTitle')}</h2>{query.trim() && <button className="secondary-button" type="button" onClick={() => onQuery('')}>{t('analysis:clearSearch')}</button>}</div>;
  const controls = <>
    <label className="search-control"><MagnifyingGlass size={18} /><span className="sr-only">{t('analysis:searchEvents')}</span>
      <input type="search" placeholder={t('analysis:searchEventsPlaceholder')} value={query} onChange={event => onQuery(event.target.value)} /></label>
    <EventSourceSwitch source={source} onSource={onSource} />
  </>;
  return <div className={`event-workspace${compare ? ' is-comparing' : ''}`}>
    {compare ? <section aria-label={t('analysis:eventPeriodComparison')}>
      <div className="event-comparison-header"><h2>{t('analysis:eventPeriodComparison')}</h2>{controls}</div>
      {previous && <p className="context-note">{t('analysis:previousRangeMeta', { range: rangeLabel(previous.meta.from, previous.meta.to), timeZone: previous.meta.timeZone })}</p>}
      <div className="event-comparison-summary"><span>{t('analysis:currentEvents')} <strong>{total === null ? '—' : formatCount(total)}</strong></span>
        <span>{t('analysis:previousEvents')} <strong>{previous ? formatCount(previous.totalEvents) : '—'}</strong></span>
        <span>{t('analysis:change')} <strong>{changeLabel(total, previous?.totalEvents ?? null)}</strong></span></div>
      <div className="table-scroll" tabIndex={0} aria-label={t('analysis:eventComparisonTable')}><table className="event-table event-comparison-table">
        <thead><tr><th scope="col">{t('analysis:event')}</th><th scope="col" className="number-cell">{t('analysis:current')}</th><th scope="col" className="number-cell">{t('analysis:previous')}</th><th scope="col" className="number-cell">{t('analysis:difference')}</th><th scope="col" className="number-cell">{t('analysis:change')}</th><th scope="col">{t('analysis:currentPrevious')}</th></tr></thead>
        <tbody>{visible.map(row => {
          const previousCount = before.get(row.definition.name) ?? null;
          const delta = row.count === null || previousCount === null ? null : row.count - previousCount;
          return <tr key={row.definition.name} aria-selected={selectedEvent === row.definition.name}>
            <th scope="row"><button className="text-button event-comparison-name" type="button" aria-label={row.definition.name} aria-pressed={selectedEvent === row.definition.name} onClick={() => onSelect(row.definition.name)}>{row.definition.label}<small>{row.definition.name}</small></button></th>
            <td className="number-cell">{row.count === null ? '—' : formatCount(row.count)}</td><td className="number-cell">{previousCount === null ? '—' : formatCount(previousCount)}</td>
            <td className="number-cell" data-change={delta === null || delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down'}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatCount(delta)}`}</td><td className="number-cell" data-change={delta === null || delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down'}>{changeLabel(row.count, previousCount)}</td>
            <td><div className="event-comparison-bars">{row.count !== null && <meter min={0} max={barMaximum} value={row.count} aria-label={t('analysis:currentCountAria', { name: row.definition.label })} />}{previousCount !== null && <meter min={0} max={barMaximum} value={previousCount} aria-label={t('analysis:previousCountAria', { name: row.definition.label })} />}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {empty}
    </section> : <aside className="event-explorer" aria-label={t('analysis:eventExplorer')}>
      <div className="event-explorer-heading"><h2>{t('analysis:eventExplorer')}</h2></div>{controls}
      <p className="event-explorer-count">{t('analysis:registeredEventsCount', { count: formatCount(scoped.length) })}{query.trim() && t('analysis:searchResultsSuffix', { count: formatCount(visible.length) })}</p>
      <div className="event-explorer-list">{visible.map(row => <button key={row.definition.name} type="button" className="event-explorer-item" aria-label={row.definition.name} aria-pressed={selectedEvent === row.definition.name} onClick={() => onSelect(row.definition.name)}>
        <span className="event-explorer-label"><strong>{row.definition.label}</strong><small>{row.definition.name}</small></span>
        <strong className="event-explorer-value">{row.count === null ? '—' : formatCount(row.count)}</strong>
      </button>)}</div>
      {empty}
      <footer className="event-explorer-total"><span>{t('analysis:allEventTotal')}</span><strong>{total === null ? '—' : formatCount(total)}</strong></footer>
    </aside>}
    <section className="event-inspector" aria-label={t('analysis:selectedEventDetail')}>
      {selected ? <div className="event-inspector-heading"><div><small>{t('analysis:eventBreadcrumb', { name: selected.definition.name })}</small><h2>{selected.definition.label}</h2></div>
        <div className="event-inspector-count"><strong>{selected.count === null ? '—' : formatCount(selected.count)}<span>{t('analysis:unitCount')}</span></strong><span>{t('analysis:selectedPeriodTotal')}</span></div></div>
        : <div className="state-panel"><h2>{t('analysis:selectEvent')}</h2><p>{t('analysis:selectEventHelp')}</p></div>}
      <div className="event-inspector-body">{children}</div>
    </section>
  </div>;
}
