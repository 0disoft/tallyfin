import type { DiagnosticRead } from './api/collection-diagnostics.ts';
import type { RejectionReason, RejectionResponse } from './api/rejection-diagnostics.ts';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import { useMessageText } from './i18n/messages';

function RecordedTime({ value }: { value: string | null }) {
  const { t } = useI18n();
  const { dateTime } = useLocaleFormat();
  return value === null ? <>{t('operations:rejectNone')}</> : <time dateTime={value}>{dateTime(value, 'UTC')}</time>;
}

export default function CollectionRejections({ read }: { read: DiagnosticRead<RejectionResponse> }) {
  const { t } = useI18n();
  const { count: formatCount, dateTime } = useLocaleFormat();
  const messageText = useMessageText();
  const data = read.value;
  const reasonLabel = (reason: RejectionReason) => {
    switch (reason) {
      case 'minute_limit': return t('operations:rejectReasonMinuteLimit');
      case 'daily_limit': return t('operations:rejectReasonDailyLimit');
      case 'origin_denied': return t('operations:rejectReasonOriginDenied');
      case 'project_unavailable': return t('operations:rejectReasonProjectUnavailable');
      case 'unknown_schema': return t('operations:rejectReasonUnknownSchema');
      case 'invalid_request': return t('operations:rejectReasonInvalidRequest');
      case 'invalid_event': return t('operations:rejectReasonInvalidEvent');
      case 'event_conflict': return t('operations:rejectReasonEventConflict');
      case 'attempt_conflict': return t('operations:rejectReasonAttemptConflict');
      case 'storage_unavailable': return t('operations:rejectReasonStorageUnavailable');
      default: return reason;
    }
  };
  return <section className="collection-rejections" aria-labelledby="collection-rejections-heading">
    <h3 id="collection-rejections-heading" className="settings-subheading">{t('operations:rejectHeading')}</h3>
    <p className="context-note">{t('operations:rejectIntro')}</p>
    {read.error ? <p className="form-error" role="alert">{t('operations:rejectError', { message: messageText(read.error.message) })}</p> : data && <>
      <dl className="diagnostic-facts">
        <div><dt>{t('operations:rejectRecorded')}</dt><dd>{t('operations:rejectCount', { count: formatCount(data.summary.rejectedRequests) })}</dd></div>
        <div><dt>{t('operations:rejectLast')}</dt><dd><RecordedTime value={data.summary.lastRejectedAt} /></dd></div>
      </dl>
      <p className="field-help">{t('operations:rejectRangeLead', { from: data.meta.from, to: data.meta.to })}<time dateTime={data.meta.generatedAt}>{dateTime(data.meta.generatedAt, 'UTC')}</time>{t('operations:rejectRangeNote')}</p>
      {data.summary.rejectedRequests === 0 && <p role="status">{t('operations:rejectEmpty')}</p>}
      <details className="rejection-details"><summary>{t('operations:rejectByReason')}</summary>
        <div className="rejection-table-scroll" tabIndex={0} role="region" aria-label={t('operations:rejectReasonTableLabel')}>
          <table><caption>{t('operations:rejectReasonCaption')}</caption>
            <thead><tr><th scope="col">{t('operations:rejectReasonColumn')}</th><th scope="col">{t('operations:rejectCountColumn')}</th><th scope="col">{t('operations:rejectLastColumn')}</th></tr></thead>
            <tbody>{data.summary.reasons.map(row => <tr key={row.reason}><th scope="row">{reasonLabel(row.reason)}</th>
              <td>{formatCount(row.count)}</td><td><RecordedTime value={row.lastRejectedAt} /></td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <details className="rejection-details"><summary>{t('operations:rejectByDay')}</summary>
        <div className="rejection-table-scroll" tabIndex={0} role="region" aria-label={t('operations:rejectDayTableLabel')}>
          <table><caption>{t('operations:rejectDayCaption')}</caption>
            <thead><tr><th scope="col">{t('operations:rejectDateColumn')}</th><th scope="col">{t('operations:rejectCountColumn')}</th><th scope="col">{t('operations:rejectLastColumn')}</th></tr></thead>
            <tbody>{[...data.days].reverse().map(row => <tr key={row.date}><th scope="row">{row.date}</th>
              <td>{formatCount(row.rejectedRequests)}</td><td><RecordedTime value={row.lastRejectedAt} /></td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>}
  </section>;
}
