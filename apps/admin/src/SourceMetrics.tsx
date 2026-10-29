import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import type { EventSource } from './api/types';
import type { WorkflowLoad } from './api/period-comparison';
import { countChange } from './api/period-comparison';
import HelpTerm from './HelpTerm';

export default function SourceMetrics({ source, totalEvents, primary, startLabel, successLabel, previousTotal }: {
  source: EventSource; totalEvents: number; primary: WorkflowLoad | null; startLabel: string; successLabel: string;
  previousTotal?: number;
}) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const change = countChange(totalEvents, previousTotal ?? null);
  const metrics = [
    [t(source === 'browser' ? 'admin:collectedBrowserEvents' : 'admin:collectedServerEvents'), formatCount(totalEvents), t('analysis:helpCollectedEvents')],
    [t('admin:workflowStarted', { workflow: primary?.definition.label ?? startLabel }), primary ? formatCount(primary.response.summary.startedAttempts) : '—', t('analysis:helpWorkflow')],
    [t('admin:workflowSucceeded', { workflow: primary?.definition.label ?? successLabel }), primary ? formatCount(primary.response.summary.succeededAttempts) : '—', t('analysis:helpWorkflow')],
    [t('admin:completionRate'), primary ? formatRate(primary.response.summary.completionRate) : '—', t('analysis:helpCompletionRate')],
  ];
  return <section className="metric-grid" aria-label={t('admin:majorMetrics')}>
    {metrics.filter((_, index) => source === 'browser' || index === 0).map(([label, value, help], index) => <div className="metric" key={label}>
      <div className="metric-label"><HelpTerm content={help}>{label}</HelpTerm></div><div className="metric-value">{value}</div>
      {index === 0 && previousTotal !== undefined && <div className="metric-detail">{change === null ? t('admin:previousZero') : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`} · {t('admin:previousCount', { count: formatCount(previousTotal) })}</div>}
      {index === 3 && primary && <div className="metric-detail">{formatCount(primary.response.summary.succeededAttempts)} / {formatCount(primary.response.summary.startedAttempts)}</div>}
    </div>)}
  </section>;
}
