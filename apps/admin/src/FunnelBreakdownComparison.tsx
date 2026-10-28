import { compareFunnelBreakdowns, funnelValueKey } from './api/funnel-breakdown-comparison';
import type { FunnelBreakdown } from './api/funnel-breakdown';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

export default function FunnelBreakdownComparison({ current, previous, selection, onSelect }: {
  current: FunnelBreakdown; previous: FunnelBreakdown; selection: string | null; onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const buckets = compareFunnelBreakdowns(current, previous);
  const active = buckets.find(bucket => funnelValueKey(bucket.value) === selection);
  const change = (value: number | null, unit: string) => {
    if (value === null) return '—';
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}${unit}`;
  };
  const label = (row: (typeof buckets)[number]['rows'][number]) => {
    if (row.key === 'started') return t('analysis:startedRuns');
    if (row.key === 'completed') return t('analysis:completedRuns');
    if (row.key === 'completion') return t('analysis:completionRate');
    const match = /^step:(\d+):(reached|reach-rate|conversion)$/.exec(row.key);
    if (!match) return row.label;
    const stage = Number(match[1]) + 1;
    return match[2] === 'reached' ? t('analysis:stepReached', { stage })
      : match[2] === 'reach-rate' ? t('analysis:stepReachRate', { stage }) : t('analysis:stepConversion', { stage });
  };
  return <section className="table-section">
    <h4>{t('analysis:funnelPropertyComparison')}</h4>
    <p className="context-note">{t('analysis:funnelPropertyRangeMeta', { currentFrom: current.meta.from, currentTo: current.meta.to, previousFrom: previous.meta.from, previousTo: previous.meta.to, timeZone: current.meta.timeZone })}</p>
    {!buckets.length ? <p role="status">{t('analysis:noFunnelPropertyValues')}</p> : <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:funnelPropertyComparisonTable')}><table className="event-table funnel-table">
        <caption className="sr-only">{t('analysis:funnelPropertyComparisonCaption')}</caption>
        <thead><tr><th scope="col">{t('analysis:propertyValues')}</th><th scope="col" className="number-cell">{t('analysis:currentStarted')}</th><th scope="col" className="number-cell">{t('analysis:previousStarted')}</th>
          <th scope="col" className="number-cell">{t('analysis:currentCompletionRate')}</th><th scope="col" className="number-cell">{t('analysis:previousCompletionRate')}</th><th scope="col" className="number-cell">{t('analysis:completionRateDifference')}</th></tr></thead>
        <tbody>{buckets.map(bucket => { const key = funnelValueKey(bucket.value); return <tr key={key}>
          <th scope="row"><button className="text-button" type="button" aria-pressed={selection === key} onClick={() => onSelect(key)}>{String(bucket.value)}</button></th>
          <td className="number-cell">{formatCount(bucket.current.startedRuns)}</td><td className="number-cell">{formatCount(bucket.previous.startedRuns)}</td>
          <td className="number-cell">{formatRate(bucket.current.completionRate)}</td><td className="number-cell">{formatRate(bucket.previous.completionRate)}</td>
          <td className="number-cell">{change(bucket.rows.find(row => row.key === 'completion')!.change, '%p')}</td></tr>; })}</tbody>
      </table></div>
      <p className="context-note">{t('analysis:funnelPropertyNote')}</p>
    </>}
    {active && <>
      <h4>{t('analysis:valuePeriodComparison', { value: String(active.value) })}</h4>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:selectedValuePeriodTable')}><table className="event-table funnel-table">
        <caption className="sr-only">{t('analysis:selectedValuePeriodCaption')}</caption>
        <thead><tr><th scope="col">{t('analysis:metric')}</th><th scope="col" className="number-cell">{t('analysis:current')}</th><th scope="col" className="number-cell">{t('analysis:previous')}</th><th scope="col" className="number-cell">{t('analysis:change')}</th></tr></thead>
        <tbody>{active.rows.map(row => <tr key={row.key}><th scope="row">{label(row)}</th>
          <td className="number-cell">{row.rate ? formatRate(row.current) : row.current === null ? '—' : formatCount(row.current)}</td>
          <td className="number-cell">{row.rate ? formatRate(row.previous) : row.previous === null ? '—' : formatCount(row.previous)}</td>
          <td className="number-cell">{change(row.change, row.unit)}</td></tr>)}</tbody>
      </table></div>
    </>}
    <p className="context-note">{t('analysis:funnelPropertyComparisonNote')}</p>
    {[current, previous].some(report => report.buckets.some(bucket => bucket.days.some(day => day.provisional))) &&
      <p className="notice" role="status">{t('analysis:provisionalFunnelPropertyComparison')}</p>}
  </section>;
}
