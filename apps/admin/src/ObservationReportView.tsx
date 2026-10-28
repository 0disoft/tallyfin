import { useState } from 'react';
import type { ObservationReport } from './api/observation-report.ts';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import './observation-report.css';

type Diagnostics = NonNullable<ObservationReport['diagnostics']>;
type Finding = Diagnostics['findings'][number];

const RESPONSE_PAGE_SIZE = 25;

const severityClass = (severity: Finding['severity']) =>
  severity === 'error' ? 'observation-severity-error' : 'observation-severity-review';

function ObservationOperation({ operation, page, onPage }: {
  operation: ObservationReport['operations'][number]; page: number; onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  const operationLabel = (value: Finding['operation']) => {
    switch (value) {
      case 'browser_collection': return t('operations:obsOpBrowserCollection');
      case 'server_collection': return t('operations:obsOpServerCollection');
      case 'administrator': return t('operations:obsOpAdministrator');
      case 'other': return t('operations:obsOpOther');
      case 'retention_cleanup': return t('operations:obsOpRetentionCleanup');
      default: return value;
    }
  };
  const bucketLabel = (bucket: string) => {
    switch (bucket) {
      case 'lt_10ms': return t('operations:obsBucketLt10');
      case 'lt_50ms': return t('operations:obsBucketLt50');
      case 'lt_250ms': return t('operations:obsBucketLt250');
      case 'lt_1000ms': return t('operations:obsBucketLt1000');
      case 'gte_1000ms': return t('operations:obsBucketGte1000');
      case 'unknown': return t('operations:obsBucketUnknown');
      default: return bucket;
    }
  };
  const rows = operation.responses;
  const pageCount = Math.max(1, Math.ceil(rows.length / RESPONSE_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * RESPONSE_PAGE_SIZE;
  const visible = rows.slice(start, start + RESPONSE_PAGE_SIZE);
  const label = operationLabel(operation.operation);
  return <article className="observation-operation">
    <div className="observation-operation-head">
      <h4>{label}</h4>
      <code className="observation-operation-code">{operation.operation}</code>
    </div>
    <dl className="observation-facts">
      <div><dt>{t('operations:obsObservedResponses')}</dt><dd>{t('operations:obsObservedRows', { count: formatCount(operation.observedResponses) })}</dd></div>
      <div><dt>{t('operations:obsEstimatedRequests')}</dt><dd>{t('operations:obsEstimatedValue', { count: formatCount(operation.weightedRequestsEstimate) })}</dd></div>
    </dl>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('operations:obsResponseTableLabel', { label })}>
      <table className="event-table observation-table">
        <caption className="sr-only">{t('operations:obsResponseCaption', { label })}</caption>
        <thead><tr><th scope="col">{t('operations:obsStatusColumn')}</th><th scope="col">{t('operations:obsCodeColumn')}</th>
          <th scope="col" className="number-cell">{t('operations:obsObservedResponses')}</th><th scope="col" className="number-cell">{t('operations:obsEstimatedRequests')}</th></tr></thead>
        <tbody>{visible.map(row => <tr key={`${row.status}:${row.code}`}>
          <th scope="row">{row.status}</th>
          <td><code>{row.code}</code></td>
          <td className="number-cell">{formatCount(row.observedResponses)}</td>
          <td className="number-cell">{t('operations:obsEstimatedValue', { count: formatCount(row.weightedRequestsEstimate) })}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pageCount > 1 && <div className="observation-pager">
      <button className="secondary-button" type="button" disabled={current === 0} onClick={() => onPage(current - 1)}>{t('operations:obsPreviousPage', { size: RESPONSE_PAGE_SIZE })}</button>
      <p className="observation-page-status" role="status">{t('operations:obsPageStatus', { page: current + 1, pages: pageCount, start: formatCount(start + 1), end: formatCount(start + visible.length), total: formatCount(rows.length) })}</p>
      <button className="secondary-button" type="button" disabled={current >= pageCount - 1} onClick={() => onPage(current + 1)}>{t('operations:obsNextPage', { size: RESPONSE_PAGE_SIZE })}</button>
    </div>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('operations:obsLatencyTableLabel', { label })}>
      <table className="event-table observation-table">
        <caption className="sr-only">{t('operations:obsLatencyCaption', { label })}</caption>
        <thead><tr><th scope="col">{t('operations:obsLatencyColumn')}</th>
          <th scope="col" className="number-cell">{t('operations:obsObservedResponses')}</th><th scope="col" className="number-cell">{t('operations:obsEstimatedRequests')}</th></tr></thead>
        <tbody>{operation.latencyBuckets.map(row => <tr key={row.bucket}>
          <th scope="row">{bucketLabel(row.bucket)}</th>
          <td className="number-cell">{formatCount(row.observedResponses)}</td>
          <td className="number-cell">{t('operations:obsEstimatedValue', { count: formatCount(row.weightedRequestsEstimate) })}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </article>;
}

/** Read-only view of the CLI observation summary. The parent panel owns the file reader and scope note. */
export default function ObservationReportView({ report }: { report: ObservationReport }) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  // Page state is bound to the report object, so a new report always starts back at the first page.
  const [paging, setPaging] = useState<{ report: ObservationReport; pages: Record<string, number> }>({ report, pages: {} });
  const pages = paging.report === report ? paging.pages : {};
  const changePage = (operation: string, page: number) => setPaging(current => ({
    report, pages: { ...(current.report === report ? current.pages : {}), [operation]: page },
  }));
  const severityLabel = (value: Finding['severity']) => value === 'error'
    ? t('operations:obsSeverityError') : t('operations:obsSeverityReview');
  const unitLabel = (value: Finding['unit']) => value === 'responses'
    ? t('operations:obsUnitResponses') : t('operations:obsUnitRuns');
  const actionLabel = (value: Finding['action']) => {
    switch (value) {
      case 'inspect_storage': return t('operations:obsActionInspectStorage');
      case 'inspect_collector': return t('operations:obsActionInspectCollector');
      case 'review_collection_limits': return t('operations:obsActionReviewCollectionLimits');
      case 'review_collection_configuration': return t('operations:obsActionReviewCollectionConfiguration');
      case 'review_access_configuration': return t('operations:obsActionReviewAccessConfiguration');
      case 'review_request_contract': return t('operations:obsActionReviewRequestContract');
      case 'inspect_retention_cleanup': return t('operations:obsActionInspectRetentionCleanup');
      case 'inspect_cleanup_log_coverage': return t('operations:obsActionInspectCleanupLogCoverage');
      default: return value;
    }
  };
  const operationLabel = (value: Finding['operation']) => {
    switch (value) {
      case 'browser_collection': return t('operations:obsOpBrowserCollection');
      case 'server_collection': return t('operations:obsOpServerCollection');
      case 'administrator': return t('operations:obsOpAdministrator');
      case 'other': return t('operations:obsOpOther');
      case 'retention_cleanup': return t('operations:obsOpRetentionCleanup');
      default: return value;
    }
  };
  const cleanupReasonLabel = (reason: string) => {
    switch (reason) {
      case 'page_limit': return t('operations:obsCleanupPageLimit');
      case 'time_budget': return t('operations:obsCleanupTimeBudget');
      case 'cycle_complete': return t('operations:obsCleanupCycleComplete');
      case 'empty_page': return t('operations:obsCleanupEmptyPage');
      case 'cursor_conflict': return t('operations:obsCleanupCursorConflict');
      case 'cancelled': return t('operations:obsCleanupCancelled');
      case 'storage_error': return t('operations:obsCleanupStorageError');
      default: return reason;
    }
  };
  const diagnostics = report.diagnostics;
  const findings = diagnostics?.findings ?? [];
  return <section className="observation-report" aria-label={t('operations:obsSectionLabel')}>
    <h3 className="settings-subheading">{t('operations:obsSummaryHeading')}</h3>
    <dl className="observation-facts">
      <div><dt>{t('operations:obsObservedResponses')}</dt><dd>{t('operations:obsObservedRows', { count: formatCount(report.observedResponses) })}</dd></div>
      <div><dt>{t('operations:obsEstimatedRequests')}</dt><dd>{t('operations:obsEstimatedValue', { count: formatCount(report.weightedRequestsEstimate) })}</dd></div>
    </dl>
    <p className="context-note">{t('operations:obsIntro1')}</p>
    <p className="context-note">{t('operations:obsIntro2', { lines: formatCount(report.input.lines), blank: formatCount(report.input.blankLines), other: formatCount(report.input.ignoredOtherLogLines), duplicate: formatCount(report.input.duplicateLogLines) })}</p>

    <div className="table-section observation-diagnostics">
      <h3 className="settings-subheading">{t('operations:obsDiagnosticsHeading')}</h3>
      {!diagnostics
        ? <p className="notice" role="status">{t('operations:obsNoDiagnostics')}</p>
        : findings.length === 0
          ? <p className="notice" role="status">{t('operations:obsNoFindings')}</p>
          : <>
            <p className="context-note">{t('operations:obsFindingsNote')}</p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t('operations:obsFindingsTableLabel')}>
              <table className="event-table observation-table">
                <caption className="sr-only">{t('operations:obsFindingsCaption')}</caption>
                <thead><tr><th scope="col">{t('operations:obsSeverityColumn')}</th><th scope="col">{t('operations:obsOperationColumn')}</th><th scope="col">{t('operations:obsCodeColumn')}</th><th scope="col">{t('operations:obsUnitColumn')}</th>
                  <th scope="col" className="number-cell">{t('operations:obsCountColumn')}</th><th scope="col">{t('operations:obsActionColumn')}</th></tr></thead>
                <tbody>{findings.map(finding => <tr key={`${finding.operation}:${finding.code}`}>
                  <th scope="row" className={severityClass(finding.severity)}>{severityLabel(finding.severity)}</th>
                  <td>{operationLabel(finding.operation)}</td>
                  <td><code>{finding.code}</code></td>
                  <td>{unitLabel(finding.unit)}</td>
                  <td className="number-cell">{formatCount(finding.observedCount)}</td>
                  <td>{actionLabel(finding.action)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
    </div>

    <div className="table-section observation-operations">
      <h3 className="settings-subheading">{t('operations:obsOperationsHeading')}</h3>
      {report.operations.length === 0
        ? <p className="notice" role="status">{t('operations:obsNoOperations')}</p>
        : <>
          <p className="context-note">{t('operations:obsOperationsNote', { size: RESPONSE_PAGE_SIZE })}</p>
          {report.operations.map(operation => <ObservationOperation key={operation.operation} operation={operation}
            page={pages[operation.operation] ?? 0} onPage={page => changePage(operation.operation, page)} />)}
        </>}
    </div>

    <div className="table-section observation-cleanup">
      <h3 className="settings-subheading">{t('operations:obsCleanupHeading')}</h3>
      <dl className="observation-facts">
        <div><dt>{t('operations:obsRunsObserved')}</dt><dd>{t('operations:obsRunsValue', { count: formatCount(report.cleanup.observedRuns) })}</dd></div>
        <div><dt>{t('operations:obsReportlessFailures')}</dt><dd>{t('operations:obsRunsValue', { count: formatCount(report.cleanup.reportlessFailureRuns) })}</dd></div>
        <div><dt>{t('operations:obsAttemptedProjects')}</dt><dd>{report.cleanup.reportedRuns ? t('operations:obsRunsValue', { count: formatCount(report.cleanup.attemptedProjects) }) : '—'}</dd></div>
        <div><dt>{t('operations:obsCompletedProjects')}</dt><dd>{report.cleanup.reportedRuns ? t('operations:obsRunsValue', { count: formatCount(report.cleanup.completedProjects) }) : '—'}</dd></div>
        <div><dt>{t('operations:obsFailedProjects')}</dt><dd>{report.cleanup.reportedRuns ? t('operations:obsRunsValue', { count: formatCount(report.cleanup.failedProjects) }) : '—'}</dd></div>
      </dl>
      {report.cleanup.metrics && <dl className="metric-list">
        <div><dt>{t('operations:obsDeletedRows')}</dt><dd>{formatCount(report.cleanup.metrics.deletedRows)}</dd></div>
        <div><dt>{t('operations:obsSaturatedTables')}</dt><dd>{formatCount(report.cleanup.metrics.saturatedTables)}</dd></div>
        <div><dt>{t('operations:obsOldestExpired')}</dt><dd>{report.cleanup.metrics.oldestExpiredReceiptAgeMs === null ? t('operations:obsNoExpired') : t('operations:obsMinutes', { count: Math.ceil(report.cleanup.metrics.oldestExpiredReceiptAgeMs / 60000) })}</dd></div>
        <div><dt>{t('operations:obsCapacityLimited')}</dt><dd>{t('operations:obsRunsValue', { count: formatCount(report.cleanup.metrics.capacityLimitedProjects) })}</dd></div>
      </dl>}
      {report.cleanup.execution && <>
        <dl className="metric-list">
          <div><dt>{t('operations:obsStopReasonsReported')}</dt><dd>{t('operations:obsRunsOfTotal', { count: formatCount(report.cleanup.execution.reportedRuns), total: formatCount(report.cleanup.reportedRuns) })}</dd></div>
          <div><dt>{t('operations:obsMaxElapsed')}</dt><dd>{formatCount(report.cleanup.execution.maxElapsedMs)}ms</dd></div>
          <div><dt>{t('operations:obsMaxLag')}</dt><dd>{report.cleanup.execution.maxScheduleLagMs === null ? t('operations:obsNoLag') : `${formatCount(report.cleanup.execution.maxScheduleLagMs)}ms`}</dd></div>
          <div><dt>{t('operations:obsInterrupted')}</dt><dd>{t('operations:obsRunsValue', { count: formatCount(report.cleanup.execution.interruptedProjects) })}</dd></div>
          <div><dt>{t('operations:obsCheckpointed')}</dt><dd>{t('operations:obsRunsValue', { count: formatCount(report.cleanup.execution.checkpointedProjects) })}</dd></div>
          {report.cleanup.execution.stopReasons.map(row => <div key={row.reason}><dt>{cleanupReasonLabel(row.reason)}</dt><dd>{t('operations:obsRunsValue', { count: formatCount(row.runs) })}</dd></div>)}
        </dl>
        <p className="context-note">{t('operations:obsExecutionNote', { count: formatCount(report.cleanup.execution.scheduleLagSamples) })}</p>
      </>}
      {report.cleanup.metrics && <p className="context-note">{t('operations:obsMetricsNote', { count: formatCount(report.cleanup.metrics.measuredProjects) })}</p>}
      {report.cleanup.reportedRuns === 0 && <p className="context-note">{report.cleanup.observedRuns === 0
        ? t('operations:obsNoCleanupLog')
        : t('operations:obsNoCleanupDetail')}</p>}
      <p className="context-note">{t('operations:obsCleanupNote')}</p>
    </div>
  </section>;
}
