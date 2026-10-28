import type { View } from './data';
import { comparisonRows, countChange, rateChange, type ComparisonRow, type PeriodSnapshot } from './api/period-comparison';
import { rangeLabel } from './api/dates';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

function difference(row: ComparisonRow, unavailable: { rate: string; previousZero: string; generic: string }): string {
  const change = row.rate ? rateChange(row.current, row.previous) : countChange(row.current, row.previous);
  if (change === null) return row.rate ? unavailable.rate : row.previous === 0 ? unavailable.previousZero : unavailable.generic;
  const rounded = Math.round(change * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)}${row.rate ? '%p' : '%'}`;
}
export default function PeriodComparison({ current, previous, view }: { current: PeriodSnapshot; previous: PeriodSnapshot; view: View }) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const rows = comparisonRows(current, previous, view);
  const provisional = [...current.workflows, ...previous.workflows].some(flow => flow.response.days.some(day => day.provisional));
  const label = (row: ComparisonRow) => {
    if (row.key === 'total') return t('analysis:collectedEvents');
    if (view === 'events') return row.label;
    const separator = row.key.lastIndexOf(':'), metric = row.key.slice(separator + 1), id = row.key.slice(0, separator);
    const flow = [...current.workflows, ...previous.workflows].find(item => item.definition.id === id);
    const translated = metric === 'startedAttempts' ? t('analysis:started') : metric === 'succeededAttempts' ? t('analysis:succeeded')
      : metric === 'completionRate' ? t('analysis:completionRate') : null;
    return flow && translated ? `${flow.definition.label} · ${translated}` : row.label;
  };
  return <section className="table-section period-comparison" aria-labelledby="comparison-heading">
    <h2 id="comparison-heading">{t('analysis:periodComparison')}</h2>
    <p className="context-note">{t('analysis:propertyRangeMeta', { current: rangeLabel(current.range.from, current.range.to), previous: rangeLabel(previous.range.from, previous.range.to) })}</p>
    <div className="table-scroll" tabIndex={0} aria-label={t('analysis:periodComparisonTable')}><table className="event-table">
      <caption className="sr-only">{t('analysis:periodComparisonCaption')}</caption>
      <thead><tr><th scope="col">{t('analysis:metric')}</th><th scope="col" className="number-cell">{t('analysis:current')}</th><th scope="col" className="number-cell">{t('analysis:previous')}</th><th scope="col" className="number-cell">{t('analysis:change')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{label(row)}</th><td className="number-cell">{row.rate ? formatRate(row.current) : row.current === null ? '—' : formatCount(row.current)}</td><td className="number-cell">{row.rate ? formatRate(row.previous) : row.previous === null ? '—' : formatCount(row.previous)}</td><td className="number-cell">{difference(row, { rate: t('analysis:completionComparisonUnavailable'), previousZero: t('analysis:previousZeroChangeUnavailable'), generic: t('analysis:comparisonUnavailable') })}</td></tr>)}</tbody>
    </table></div>
    <p className="context-note">{t('analysis:periodComparisonNote')}{provisional && t('analysis:provisionalComparisonNote')}</p>
  </section>;
}
