import { ArrowRight, Circle } from '@phosphor-icons/react';
import { Trend } from './Dashboard';
import SourceMetrics from './SourceMetrics';
import type { View } from './data';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import { workflowRecords, type EventRow } from './api/dashboard-model';
import type { WorkflowLoad } from './api/period-comparison';
import type { EventSource } from './api/types';
import HelpTerm from './HelpTerm';
import './event-shell.css';
import './overview-workspace.css';

type Props = {
  source: EventSource; totalEvents: number; rows: EventRow[]; primary: WorkflowLoad | null;
  startLabel: string; successLabel: string; previousTotal?: number;
  onNavigate?: (view: View) => void;
};

export default function OverviewWorkspace({ source, totalEvents, rows, primary, startLabel, successLabel, previousTotal, onNavigate }: Props) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  const visible = rows.filter(row => row.source === source || row.source === null)
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  const maximum = visible.reduce((max, row) => Math.max(max, row.count ?? 0), 1);
  const outcome = primary?.response.summary;
  return <div className="overview-workspace">
    <SourceMetrics source={source} totalEvents={totalEvents} primary={primary} startLabel={startLabel} successLabel={successLabel} previousTotal={previousTotal} />
    {totalEvents === 0 && <p className="notice" role="status">{t(source === 'browser' ? 'admin:noBrowserEvents' : 'admin:noServerEvents')}</p>}
    <div className="overview-columns">
      <section className="overview-trend" aria-labelledby="overview-trend-heading">
        {primary ? <>
          <div className="section-header"><h2 id="overview-trend-heading">{t('admin:workflowDailyStarts', { workflow: primary.definition.label })}</h2></div>
          <div className="legend"><Circle size={10} weight="fill" color="#155EEF" />{t('admin:startedAttempts')}</div>
          <div className="chart-panel"><Trend records={workflowRecords(primary)} event={primary.definition.startEvent} kind="bar" /></div>
        </> : <div className="state-panel" role="status">
          <h2 id="overview-trend-heading">{t(source === 'server' ? 'admin:serverEventAnalysis' : 'admin:noRepresentativeWorkflow')}</h2>
          <p>{t(source === 'server' ? 'admin:serverAnalysisHelp' : 'admin:representativeWorkflowHelp')}</p>
          {source === 'browser' && onNavigate && <button className="secondary-button" type="button" onClick={() => onNavigate('settings')}>{t('admin:viewSchemaSettings')}</button>}
        </div>}
      </section>
      <section className="overview-events" aria-labelledby="overview-events-heading">
        <div className="section-header"><h2 id="overview-events-heading" aria-label={t('admin:registeredEventCounts')}>{t('admin:topEvents')}</h2>
          {onNavigate && <button className="text-button" type="button" onClick={() => onNavigate('events')}>{t('admin:viewEventAnalysis')}<ArrowRight size={16} /></button>}</div>
        <div className="overview-event-list">{visible.map(row => <div className="overview-event-row" key={row.definition.name}>
          <span className="overview-event-label"><strong>{row.definition.label}</strong><small>{row.definition.name}{row.source === null && ` · ${t('admin:unregistered')}`}</small></span>
          <strong className="overview-event-count">{row.count === null ? '—' : formatCount(row.count)}</strong>
          {row.count !== null && <meter className="overview-event-bar" min={0} max={maximum} value={row.count} aria-label={t('admin:eventCountLabel', { name: row.definition.label })} />}
        </div>)}</div>
        {!visible.length && <p role="status">{t('admin:noRegisteredEvents')}</p>}
      </section>
    </div>
    {primary && outcome && <section className="overview-outcomes" aria-labelledby="overview-outcomes-heading">
      <h2 id="overview-outcomes-heading">{t('admin:workflowProgress', { workflow: primary.definition.label })}</h2>
      <dl>{([[t('admin:startedAttempts'), outcome.startedAttempts, t('analysis:helpWorkflow')], [t('admin:succeeded'), outcome.succeededAttempts, t('analysis:helpWorkflow')], [t('admin:confirmedFailed'), outcome.failedAttempts, t('analysis:helpConfirmedFailure')], [t('admin:pending'), outcome.pendingAttempts, t('analysis:helpPending')]] as const).map(([label, count, help]) => <div key={label}><dt><HelpTerm content={help}>{label}</HelpTerm></dt><dd>{count === null ? t('admin:undefined') : formatCount(count)}</dd></div>)}</dl>
      {onNavigate && <button className="text-button" type="button" onClick={() => onNavigate('goals')}>{t('admin:viewGoals')}<ArrowRight size={16} /></button>}
    </section>}
  </div>;
}
