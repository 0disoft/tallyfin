import { useId } from 'react';
import type { FailureReasons } from './api/workflow-failure-reasons';
import type { WorkflowDefinition } from './api/types';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

export default function WorkflowFailureReasons({ definition, reasons, failed, provisional, visual = false }: {
  definition: WorkflowDefinition; reasons: FailureReasons | null | undefined; failed: number | null; provisional: boolean;
  visual?: boolean;
}) {
  const heading = useId();
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const empty = definition.failureEvent === null ? t('analysis:noFailureEvent')
    : !definition.failureReasonProperty ? t('analysis:failureReasonNotConfigured')
    : !reasons ? t('analysis:failureReasonsUnavailable')
    : !failed ? t('analysis:noConfirmedFailures')
    : reasons.measuredFailures === 0 ? t('analysis:failureReasonUnmeasured') : null;
  return <section className="workflow-failure-reasons" aria-labelledby={heading}>
    <h3 id={heading}>{t('analysis:failureReasons')}</h3>
    <p className="context-note">{t('analysis:failureReasonNote')}</p>
    {reasons && <p className="context-note">{t('analysis:failureReasonMeta', { property: reasons.property, measured: formatCount(reasons.measuredFailures), missing: formatCount(reasons.missingReasonFailures), unmeasured: formatCount(reasons.unmeasuredFailures) })}{provisional && t('analysis:provisionalSuffix')}</p>}
    {reasons && reasons.unmeasuredFailures > 0 && <p className="context-note">{t('analysis:failureReasonUnmeasuredNote')}</p>}
    {empty ? <p role="status">{empty}</p> : reasons && <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:failureReasonDistribution')}><table className="event-table">
      <thead><tr><th scope="col">{t('analysis:reason')}</th><th scope="col">{t('analysis:failed')}</th><th scope="col">{t('analysis:shareOfConfirmedFailures')}</th></tr></thead>
      <tbody>{[...reasons.buckets, { value: t('analysis:missingReason'), failedAttempts: reasons.missingReasonFailures }].map((bucket, index) =>
        <tr key={index}><th scope="row">{bucket.value}</th><td>{formatCount(bucket.failedAttempts)}</td>
          <td><div className={visual ? 'goal-reason-share' : undefined}>{visual && !!failed && <progress max={100} value={bucket.failedAttempts / failed * 100} aria-hidden="true" />}
            <span>{failed ? formatRate(bucket.failedAttempts / failed * 100) : '—'}</span></div></td></tr>)}</tbody>
    </table></div>}
  </section>;
}
