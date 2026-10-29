import { useId } from 'react';
import type { WorkflowDuration as Duration } from './api/workflow-duration';
import HelpTerm from './HelpTerm';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

const ranges = {
  under_1s: 'analysis:durationUnder1s', '1s_to_5s': 'analysis:duration1sTo5s', '5s_to_30s': 'analysis:duration5sTo30s',
  '30s_to_2m': 'analysis:duration30sTo2m', '2m_to_10m': 'analysis:duration2mTo10m', '10m_to_24h': 'analysis:duration10mTo24h',
} as const;

export default function WorkflowDuration({ duration, provisional }: { duration: Duration | undefined; provisional: boolean }) {
  const heading = useId();
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  return <section className="workflow-duration" aria-labelledby={heading}>
    <h3 id={heading}><HelpTerm content={t('analysis:helpDuration')}>{t('analysis:completionDuration')}</HelpTerm></h3>
    <p className="context-note">{t('analysis:durationNote')}</p>
    {!duration ? <p role="status">{t('analysis:durationUnavailable')}</p>
      : <><p className="context-note">{t('analysis:durationMeasured', { measured: formatCount(duration.measuredAttempts), unmeasured: formatCount(duration.unmeasuredAttempts) })}{provisional && t('analysis:provisionalSuffix')}</p>
        {duration.unmeasuredAttempts > 0 && <p className="context-note">{t('analysis:unmeasuredDurationNote')}</p>}
        {duration.measuredAttempts === 0 ? <p role="status">{duration.unmeasuredAttempts > 0 ? t('analysis:durationAllUnmeasured') : t('analysis:noMeasuredDuration')}</p>
          : <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:durationDistribution')}><table className="event-table"><thead><tr><th scope="col">{t('analysis:durationRange')}</th><th scope="col">{t('analysis:succeeded')}</th><th scope="col">{t('analysis:failed')}</th><th scope="col">{t('analysis:measuredShare')}</th></tr></thead>
            <tbody>{duration.buckets.map(bucket => <tr key={bucket.range}><th scope="row">{t(ranges[bucket.range])}</th>
              <td>{formatCount(bucket.succeededAttempts)}</td><td>{bucket.failedAttempts === null ? '—' : formatCount(bucket.failedAttempts)}</td>
              <td>{formatRate((bucket.succeededAttempts + (bucket.failedAttempts ?? 0)) / duration.measuredAttempts * 100)}</td></tr>)}</tbody></table></div>}
      </>}
  </section>;
}
