import type { Registry, WorkflowBreakdownResponse } from './api/types';
import { compareWorkflowProperties } from './api/workflow-analysis';
import { rangeLabel } from './api/dates';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

export default function WorkflowPropertyComparison({ current, previous, registry }: {
  current: WorkflowBreakdownResponse; previous: WorkflowBreakdownResponse; registry: Registry;
}) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const rows = compareWorkflowProperties(current, previous, registry);
  const valueLabel = (value: string | number | boolean) => typeof value === 'boolean' ? value ? t('analysis:valueTrue') : t('analysis:valueFalse') : String(value);
  const delta = (value: number | null) => {
    if (value === null) return '—';
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(1)}%p`;
  };
  return <>
    <h4>{t('analysis:workflowPropertyPeriodComparison')}</h4>
    <p className="context-note">{t('analysis:propertyRangeMeta', { current: rangeLabel(current.meta.from, current.meta.to), previous: rangeLabel(previous.meta.from, previous.meta.to) })}</p>
    {rows.length === 0 ? <p role="status">{t('analysis:noObservedWorkflowProperties')}</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label={t('analysis:workflowPropertyComparisonTable')}><table className="event-table">
        <caption className="sr-only">{t('analysis:workflowPropertyComparisonCaption', { groupBy: current.groupBy })}</caption>
        <thead><tr><th scope="col">{t('analysis:propertyValue', { property: current.groupBy })}</th><th scope="col" className="number-cell">{t('analysis:started')}<br />{t('analysis:currentPrevious')}</th><th scope="col" className="number-cell">{t('analysis:succeeded')}<br />{t('analysis:currentPrevious')}</th><th scope="col" className="number-cell">{t('analysis:completionRate')}<br />{t('analysis:currentPrevious')}</th><th scope="col" className="number-cell">{t('analysis:completionRateChange')}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={JSON.stringify(row.value)}><th scope="row">{valueLabel(row.value)}</th>
          <td className="number-cell">{formatCount(row.current.startedAttempts)} / {formatCount(row.previous.startedAttempts)}</td>
          <td className="number-cell">{formatCount(row.current.succeededAttempts)} / {formatCount(row.previous.succeededAttempts)}</td>
          <td className="number-cell">{formatRate(row.current.completionRate)} / {formatRate(row.previous.completionRate)}</td>
          <td className="number-cell">{delta(row.rateDifference)}</td></tr>)}</tbody>
      </table></div>
      <p className="context-note">{t('analysis:workflowPropertyComparisonNote')}
        {rows.some(row => row.provisional) && t('analysis:workflowPropertyProvisionalSuffix')}</p>
    </>}
  </>;
}
