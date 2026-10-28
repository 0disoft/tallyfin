import { useId } from 'react';
import type { EventPropertyComparison as Analysis } from './api/event-property-comparison';
import type { EventSeriesResponse } from './api/types';
import { rangeLabel } from './api/dates';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

function difference(value: number | null, unit: string): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}${unit}`;
}

export default function EventPropertyComparison({ current, previous, analysis }: { current: EventSeriesResponse; previous: EventSeriesResponse; analysis: Analysis }) {
  const id = useId();
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const property = current.groupBy ?? '—';
  const valueLabel = (value: string | number | boolean | null) => value === null ? t('analysis:valueMissing') : value === true ? t('analysis:valueTrue') : value === false ? t('analysis:valueFalse') : String(value);
  return <section className="property-analysis" aria-labelledby={id}>
    <h2 id={id}>{t('analysis:propertyPeriodComparison', { property })}</h2>
    <p className="context-note">{t('analysis:propertyRangeMeta', { current: rangeLabel(current.meta.from, current.meta.to), previous: rangeLabel(previous.meta.from, previous.meta.to) })}</p>
    {analysis.rows.length === 0 ? <p role="status">{t('analysis:noObservedProperties')}</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label={t('analysis:eventPropertyComparisonTable')}><table className="event-table">
        <caption className="sr-only">{t('analysis:eventPropertyComparisonCaption', { event: current.eventName, property })}</caption>
        <thead><tr><th scope="col">{t('analysis:propertyValue', { property })}</th><th scope="col" className="number-cell">{t('analysis:eventCount')}<br />{t('analysis:currentPrevious')}</th><th scope="col" className="number-cell">{t('analysis:eventCount')} {t('analysis:countChangeRate')}</th><th scope="col" className="number-cell">{t('analysis:share')}<br />{t('analysis:currentPrevious')}</th><th scope="col" className="number-cell">{t('analysis:shareChange')}</th></tr></thead>
        <tbody>{analysis.rows.map(row => <tr key={row.key}><th scope="row">{valueLabel(row.value)}</th>
          <td className="number-cell">{formatCount(row.currentCount)} / {formatCount(row.previousCount)}</td><td className="number-cell">{difference(row.countChange, '%')}</td>
          <td className="number-cell">{formatRate(row.currentShare)} / {formatRate(row.previousShare)}</td><td className="number-cell">{difference(row.shareChange, '%p')}</td></tr>)}</tbody>
      </table></div>
      <p className="context-note">{t('analysis:propertyComparisonNote')}</p>
    </>}
  </section>;
}
