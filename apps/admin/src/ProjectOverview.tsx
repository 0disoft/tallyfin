import { useI18n } from './i18n';
import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from './api/client';
import type { EventSource, Project } from './api/types';
import { countChange } from './api/period-comparison';
import { projectOverview, OVERVIEW_PAGE_SIZE, type ServiceRow } from './api/project-overview';
import OverviewWorkflowCell from './OverviewWorkflowCell';
import { overviewDateChanged, watchOverviewClock } from './api/overview-freshness';
import { shiftDate } from './api/dates';
import { useLocaleFormat } from './i18n/format';

export default function ProjectOverview({ client, projects, source, onSelectProject, activeProjectId, hasMore, onLoadMore, loadingMore }: {
  client: ApiClient; projects: Project[]; source: EventSource; onSelectProject: (id: string) => void;
  hasMore: boolean; onLoadMore: () => void; loadingMore: boolean;
  activeProjectId?: string;
}) {
  const { t } = useI18n();
  const { count: formatCount, dateTime } = useLocaleFormat();
  const [open, setOpen] = useState(false), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const index = Math.min(page, Math.max(0, Math.ceil(projects.length / OVERVIEW_PAGE_SIZE) - 1));
  const visible = useMemo(() => projects.slice(index * OVERVIEW_PAGE_SIZE, (index + 1) * OVERVIEW_PAGE_SIZE), [projects, index]);
  const key = JSON.stringify([visible, source, refresh]);
  const [result, setResult] = useState<{ client: ApiClient; key: string; rows: ServiceRow[]; error?: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setResult(null);
    projectOverview(client, visible, source, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ client, key, rows });
    }).catch(() => { if (!controller.signal.aborted) setResult({ client, key, rows: [], error: true }); });
    return () => controller.abort();
  }, [client, visible, source, open, key]);
  const rows = result?.client === client && result.key === key ? result.rows : null;
  const [checkedAt, setCheckedAt] = useState(() => new Date());
  useEffect(() => {
    if (!open || !rows?.length) return;
    return watchOverviewClock(setCheckedAt);
  }, [open, rows]);
  const dateChanged = rows ? overviewDateChanged(rows, checkedAt) : false;
  return <section className="table-section overview-services" aria-labelledby="project-overview-heading">
    <div className="settings-head"><h2 id="project-overview-heading">{t('admin:serviceOverview')}</h2>
      <button className="secondary-button" aria-expanded={open} aria-controls="overview-services-body" onClick={() => setOpen(value => !value)}>{t(open ? 'admin:closeServiceOverview' : 'admin:loadServiceOverview')}</button></div>
    {!open && <p className="context-note">{t('admin:serviceOverviewHint')}</p>}
    {open && <div id="overview-services-body" className="overview-services-body">
      <p className="context-note overview-services-context">{t('operations:overviewContext', { source: t(source === 'browser' ? 'operations:diagBrowser' : 'operations:diagServer') })}</p>
      {!!rows?.length && <p className="context-note">{t('operations:overviewCheckedAt', { time: dateTime(rows[0]!.generatedAt, 'UTC') })}</p>}
      {!!rows?.length && <p className="context-note">{t('operations:overviewRejections', { from: shiftDate(rows[0]!.generatedAt.slice(0, 10), -6), to: rows[0]!.generatedAt.slice(0, 10) })}</p>}
      {dateChanged && <p role="status">{t('operations:overviewDateChanged')}</p>}
      <div className="toolbar"><button className="secondary-button" disabled={index === 0} onClick={() => setPage(index - 1)}>{t('operations:overviewPreviousServices')}</button>
        <span>{t('operations:overviewPage', { page: index + 1, total: Math.max(1, Math.ceil(projects.length / OVERVIEW_PAGE_SIZE)) })}</span>
        <button className="secondary-button" disabled={(index + 1) * OVERVIEW_PAGE_SIZE >= projects.length} onClick={() => setPage(index + 1)}>{t('operations:overviewNextServices')}</button>
        <button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>{t('operations:overviewRefresh')}</button>
        {hasMore && <button className="secondary-button" disabled={loadingMore} onClick={onLoadMore}>{t('operations:overviewLoadMore')}</button>}</div>
      {!rows && <p role="status">{t('operations:overviewLoading')}</p>}
      {result?.client === client && result.key === key && result.error && <p role="alert">{t('operations:overviewLoadFailed')}</p>}
      {rows && !result?.error && <div className="table-scroll" tabIndex={0} aria-label={t('operations:overviewTableLabel')}><table className="event-table"><thead><tr>
        <th>{t('operations:overviewServiceColumn')}</th><th>{t('operations:overviewLatestColumn')}</th><th>{t('operations:overviewEventColumn')}</th><th>{t('operations:overviewCompletionColumn')}</th><th>{t('operations:overviewRejectionColumn')}</th>
      </tr></thead><tbody>{rows.map(row => {
        const change = row.events === null || row.previousEvents === null ? null : countChange(row.events, row.previousEvents);
        return <tr key={row.project.id} aria-selected={activeProjectId === row.project.id}><th scope="row"><button className="text-button overview-service-name" onClick={() => onSelectProject(row.project.id)}>{row.project.name}</button>
          <div className="overview-service-meta">{row.project.status === 'paused' ? t('operations:overviewPaused') : t('operations:overviewCollecting')} · {row.project.timeZone} · {row.error ? t('operations:overviewQueryFailed') : row.version === null ? t('operations:overviewNoSchema') : `v${row.version}`}</div>
          {!row.error && (row.period ? <details className="overview-service-period"><summary>{t('operations:overviewPeriod')}</summary><div>{t('operations:overviewPeriodCurrent', { from: row.period.from, to: row.period.to })}</div>
            <div>{t('operations:overviewPeriodPrevious', { from: row.period.previousFrom, to: row.period.previousTo })}</div></details> : <div>{t('operations:overviewNoPeriod')}</div>)}</th>
          {row.error ? <td colSpan={4}>{t('operations:overviewRowError')}</td> : <>
            <td>{row.latestReceivedAt ? dateTime(row.latestReceivedAt, row.project.timeZone) : t('operations:overviewNoReceipt')}</td>
            <td><strong className="overview-service-count">{row.events === null ? '—' : formatCount(row.events)}</strong><div className="overview-service-change">{change === null ? t('operations:overviewIncomparable') : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}</div></td>
            <td><OverviewWorkflowCell row={row} source={source} /></td>
            <td>{row.rejectionUnavailable ? t('operations:overviewQueryFailed') : row.rejected === null ? '—' : formatCount(row.rejected)}</td>
          </>}</tr>;
      })}</tbody></table></div>}
      <details className="overview-service-notes"><summary>{t('operations:overviewNotes')}</summary><p className="context-note">{t('operations:overviewNotesBody')}</p></details>
    </div>}
  </section>;
}
