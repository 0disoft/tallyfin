import { compareFunnels } from './api/funnel-comparison';
import type { FunnelResponse } from './api/funnel-contract';
import { rangeLabel } from './api/dates';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

export default function FunnelComparison({ current, previous }: { current: FunnelResponse; previous: FunnelResponse }) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const rows = compareFunnels(current, previous);
  const provisional = [current, previous].some(response => response.days.some(day => day.provisional));
  const value = (number: number | null, rate: boolean) => rate ? formatRate(number) : number === null ? '—' : formatCount(number);
  const change = (number: number | null, unit: string) => {
    if (number === null) return '—';
    const rounded = Math.round(number * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}${unit}`;
  };
  const label = (row: (typeof rows)[number]) => {
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
    <h3>{t('analysis:funnelPeriodComparison')}</h3>
    <p className="context-note">{t('analysis:propertyRangeMeta', { current: rangeLabel(current.meta.from, current.meta.to), previous: rangeLabel(previous.meta.from, previous.meta.to) })}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:funnelComparisonTable')}>
      <table className="event-table funnel-table">
        <caption className="sr-only">{t('analysis:funnelComparisonCaption', { funnel: current.definition.label })}</caption>
        <thead><tr><th scope="col">{t('analysis:metric')}</th><th scope="col" className="number-cell">{t('analysis:current')}</th><th scope="col" className="number-cell">{t('analysis:previous')}</th><th scope="col" className="number-cell">{t('analysis:change')}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{label(row)}</th>
          <td className="number-cell">{value(row.current, row.rate)}</td><td className="number-cell">{value(row.previous, row.rate)}</td>
          <td className="number-cell">{change(row.change, row.unit)}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="context-note">{t('analysis:funnelComparisonNote')}</p>
    {provisional && <p className="notice" role="status">{t('analysis:provisionalFunnelComparison')}</p>}
  </section>;
}
