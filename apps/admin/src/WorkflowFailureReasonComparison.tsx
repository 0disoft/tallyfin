import { useId } from 'react';
import { compareFailureReasons } from './api/failure-reason-comparison';
import type { WorkflowLoad } from './api/period-comparison';
import type { Registry } from './api/types';
import { rangeLabel } from './api/dates';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

const change = (value: number | null) => {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)}%p`;
};
export default function WorkflowFailureReasonComparison({ registry, current, previous, status }: {
  registry: Registry; current: WorkflowLoad; previous?: WorkflowLoad; status: 'loading' | 'ready' | 'error';
}) {
  const heading = useId();
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const count = (value: number | null) => value === null ? '—' : formatCount(value);
  const result = status === 'ready' && previous ? compareFailureReasons(current, previous, registry) : null;
  const coverage = (value: NonNullable<typeof result>['currentCoverage']) => value === 'unavailable' ? t('analysis:coverageUnavailable')
    : value === 'not_configured' ? t('analysis:coverageNotConfigured') : value === 'partial' ? t('analysis:coveragePartial')
      : value === 'complete' ? t('analysis:coverageComplete') : value === 'unmeasured' ? t('analysis:coverageUnmeasured') : t('analysis:coverageNoFailures');
  const notice = (value: NonNullable<typeof result>['status']) => value === 'not_configured' ? t('analysis:reasonComparisonNotConfigured')
    : value === 'unavailable' ? t('analysis:reasonComparisonUnavailable') : value === 'incomplete_measurement' ? t('analysis:reasonComparisonIncomplete')
      : value === 'no_failed_attempts' ? t('analysis:reasonComparisonNoFailures') : '';
  return <section className="workflow-failure-comparison" aria-labelledby={heading}>
    <h3 id={heading}>{t('analysis:failureReasonPeriodComparison')}</h3>
    {!result ? <p role="status">{status === 'loading' ? t('analysis:loadingPreviousFailureReasons') : t('analysis:previousFailureReasonsUnavailable')}</p>
      : <>
        <p className="context-note">{t('analysis:failureRangeMeta', { current: rangeLabel(result.range.from, result.range.to), previous: rangeLabel(result.previousRange.from, result.previousRange.to) })}</p>
        <p className="context-note">{t('analysis:failureRateNote')}</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:failureRateComparison')}><table className="event-table">
          <thead><tr><th scope="col">{t('analysis:metric')}</th><th scope="col">{t('analysis:current')}</th><th scope="col">{t('analysis:prior')}</th><th scope="col">{t('analysis:difference')}</th></tr></thead>
          <tbody><tr><th scope="row">{t('analysis:overallFailureRate')}</th><td>{formatRate(result.currentFailureRate)}</td><td>{formatRate(result.previousFailureRate)}</td><td>{change(result.failureRateChange)}</td></tr>
            <tr><th scope="row">{t('analysis:failedPerStarted')}</th><td>{count(result.currentSummary.failedAttempts)} / {count(result.currentSummary.startedAttempts)}</td>
              <td>{count(result.previousSummary.failedAttempts)} / {count(result.previousSummary.startedAttempts)}</td><td>—</td></tr></tbody>
        </table></div>
        {result.provisional && <p className="context-note" role="status">{t('analysis:provisionalFailureComparison')}</p>}
        <p className="context-note">{t('analysis:reasonCoverage', { current: coverage(result.currentCoverage), previous: coverage(result.previousCoverage) })}</p>
        {notice(result.status) && <p role="status">{notice(result.status)}</p>}
        {result.rows.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:failureReasonComparisonTable')}><table className="event-table">
          <thead><tr><th scope="col">{t('analysis:reason')}</th><th scope="col">{t('analysis:currentFailed')}</th><th scope="col">{t('analysis:previousFailed')}</th><th scope="col">{t('analysis:currentShare')}</th><th scope="col">{t('analysis:previousShare')}</th><th scope="col">{t('analysis:shareChange')}</th></tr></thead>
          <tbody>{result.rows.map(row => <tr key={`${row.kind}:${row.value}`}><th scope="row">{row.kind === 'enum' ? row.value : row.kind === 'missing' ? t('analysis:missingReason') : t('analysis:unmeasured')}</th>
            <td>{count(row.currentCount)}</td><td>{count(row.previousCount)}</td><td>{formatRate(row.currentShare)}</td><td>{formatRate(row.previousShare)}</td><td>{change(row.shareChange)}</td></tr>)}</tbody>
        </table></div>}
        <p className="context-note">{t('analysis:failureReasonComparisonNote')}</p>
      </>}
  </section>;
}
