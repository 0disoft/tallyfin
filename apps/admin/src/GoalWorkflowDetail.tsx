import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ApiClient } from './api/client';
import type { Registry, WorkflowSummary } from './api/types';
import type { DateRange, WorkflowLoad } from './api/period-comparison';
import type { WorkflowGroupingState } from './api/workflow-analysis';
import WorkflowDuration from './WorkflowDuration';
import WorkflowFailureReasons from './WorkflowFailureReasons';
import WorkflowFailureReasonComparison from './WorkflowFailureReasonComparison';
import WorkflowPropertyBreakdown from './WorkflowPropertyBreakdown';
import HelpTerm from './HelpTerm';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

type ComparisonProps = { load: WorkflowLoad; previousLoad?: WorkflowLoad; compare: boolean; comparisonError: string | null; comparisonStatus: string };
const fields = [['startedAttempts', 'analysis:started', 'analysis:helpWorkflow'], ['succeededAttempts', 'analysis:succeeded', 'analysis:helpWorkflow'], ['failedAttempts', 'analysis:confirmedFailed', 'analysis:helpConfirmedFailure'], ['pendingAttempts', 'analysis:pending', 'analysis:helpPending'], ['completionRate', 'analysis:completionRate', 'analysis:helpCompletionRate']] as const;

export function GoalWorkflowComparison({ load, previousLoad }: Pick<ComparisonProps, 'load' | 'previousLoad'>) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const current = load.response.summary, before = previousLoad?.response.summary;
  const metric = (value: number | null, rate: boolean) => rate ? formatRate(value) : value === null ? '—' : formatCount(value);
  const difference = (key: keyof WorkflowSummary) => {
    const now = current[key], prior = before?.[key];
    if (now === null || prior == null) return '—';
    const change = now - prior;
    return `${change > 0 ? '+' : ''}${key === 'completionRate' ? change.toFixed(1) : formatCount(change)}${key === 'completionRate' ? '%p' : t('analysis:unitCount')}`;
  };
  return <section className="goal-comparison"><h3>{t('analysis:periodComparison')}</h3>
    <p className="context-note">{t('analysis:sameLengthPreviousNote')}</p>
    {!previousLoad && <p className="notice" role="status">{t('analysis:previousWorkflowUnavailable')}</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:workflowComparisonTable')}><table className="event-table">
      <thead><tr><th scope="col">{t('analysis:metric')}</th><th scope="col" className="number-cell">{t('analysis:current')}</th><th scope="col" className="number-cell">{t('analysis:prior')}</th><th scope="col" className="number-cell">{t('analysis:difference')}</th></tr></thead>
      <tbody>{fields.map(([key, label, help]) => <tr key={key}><th scope="row"><HelpTerm content={t(help)}>{t(label)}</HelpTerm></th><td className="number-cell">{metric(current[key], key === 'completionRate')}</td><td className="number-cell">{metric(before?.[key] ?? null, key === 'completionRate')}</td><td className="number-cell">{difference(key)}</td></tr>)}</tbody>
    </table></div>
    {previousLoad && <p className="context-note">{t('analysis:previousRange', { from: previousLoad.response.meta.from, to: previousLoad.response.meta.to })}</p>}
    {(load.response.days.some(day => day.provisional) || previousLoad?.response.days.some(day => day.provisional)) && <p className="notice">{t('analysis:provisionalResultsNotice')}</p>}
  </section>;
}

export default function GoalWorkflowDetail({ load, previousLoad, compare, comparisonError, comparisonStatus }: ComparisonProps) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const { definition, response } = load, counts = response.summary;
  const outcomes = fields.slice(0, 4), tones = ['', 'success', 'failure', 'pending'];
  const descriptions = ['analysis:startedAttemptDescription', 'analysis:succeededAttemptDescription', 'analysis:failedAttemptDescription', 'analysis:pendingAttemptDescription'] as const;
  return <section className="goal-section">
    <p className="goal-eyebrow">{t('analysis:workflowBreadcrumb')} <code>{definition.id}</code></p>
    <div className="goal-header"><div><h2>{definition.label}</h2><p className="context-note">{t('analysis:browserMemoryWorkflow', { version: response.meta.schemaVersion })}</p></div>
      <div className="goal-ratio"><strong>{formatRate(counts.completionRate)}</strong><span>{t('analysis:completionRateRatio', { succeeded: formatCount(counts.succeededAttempts), started: formatCount(counts.startedAttempts) })}</span></div></div>
    <dl className="goal-outcomes">{outcomes.map(([key, label, help], index) => <div className={tones[index]} key={key}><dt><HelpTerm content={t(help)}>{t(label)}</HelpTerm></dt><dd>{counts[key] === null ? '—' : formatCount(counts[key]!)}</dd><span>{t(descriptions[index]!)}</span></div>)}</dl>
    {counts.startedAttempts > 0 && <div className="goal-outcome-track" aria-hidden="true">{(['succeededAttempts', 'failedAttempts', 'pendingAttempts'] as const).map((key, index) => <span key={key} className={tones[index + 1]} style={{ width: `${(counts[key] ?? 0) / counts.startedAttempts * 100}%` }} />)}</div>}
    <p className="context-note">{t('analysis:workflowBasisNote')}{counts.failedAttempts === null && t('analysis:failureUnmeasuredNote')}{response.days.some(day => day.provisional) && t('analysis:provisionalBasisNote')}</p>
    {compare && !comparisonError && comparisonStatus === 'ready' && <GoalWorkflowComparison load={load} previousLoad={previousLoad} />}
    <details className="goal-definition"><summary>{t('analysis:eventDefinition')}</summary><dl className="definition-list">
      <div><dt>{t('analysis:started')}</dt><dd>{definition.startEvent}</dd></div><div><dt>{t('analysis:succeeded')}</dt><dd>{definition.successEvent}</dd></div><div><dt>{t('analysis:failed')}</dt><dd>{definition.failureEvent ?? t('analysis:notRegistered')}</dd></div>
    </dl></details>
  </section>;
}

export function GoalWorkflowAnalysis({ client, registry, load, previousLoad, range, previous, context, onState, compare, comparisonError, comparisonStatus }: ComparisonProps & {
  client: ApiClient; registry: Registry; range: DateRange; previous: DateRange | null; context: string;
  onState: (id: string, state: WorkflowGroupingState) => void;
}) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const [panel, setPanel] = useState('overview');
  const provisional = load.response.days.some(day => day.provisional);
  const tabs = [['overview', 'analysis:overview'], ['failure', 'analysis:failureReasons'], ['duration', 'analysis:duration'], ['properties', 'analysis:propertyAnalysis']] as const;
  return <div className="goal-panel">
    <nav className="goal-tabs" aria-label={t('analysis:goalDetailAnalysis')}>{tabs.map(([key, label]) => <button type="button" key={key} aria-pressed={panel === key} onClick={() => {
      if (panel === 'properties' && key !== panel) onState(load.definition.id, { context, groupBy: '', status: 'idle' });
      setPanel(key);
    }}>{t(label)}</button>)}</nav>
    {panel === 'overview' && <section><div className="section-header"><h3>{t('analysis:dailyCompletionRate')}</h3><span className="context-note"><HelpTerm content={t('analysis:helpCohort')}>{t('analysis:startDateCohort')}</HelpTerm></span></div>
      <div className="goal-trend" role="img" aria-label={t('analysis:dailyCompletionRateAria', { workflow: load.definition.label })}>
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={load.response.days} margin={{ top: 15, right: 20, left: 0, bottom: 5 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" /><XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} axisLine={false} tickLine={false} width={48} /><Tooltip formatter={value => typeof value === 'number' ? formatRate(value) : '—'} />
          <Area type="linear" dataKey="completionRate" name={t('analysis:completionRate')} stroke="#155eef" fill="#eaf0ff" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </AreaChart></ResponsiveContainer>
      </div>
      <details><summary>{t('analysis:showDailyValues')}</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={t('analysis:workflowDailyValues')}><table className="event-table"><thead><tr><th scope="col">{t('analysis:startDate')}</th><th scope="col">{t('analysis:started')}</th><th scope="col">{t('analysis:succeeded')}</th><th scope="col">{t('analysis:completionRate')}</th><th scope="col">{t('analysis:status')}</th></tr></thead><tbody>{load.response.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{formatCount(day.startedAttempts)}</td><td>{formatCount(day.succeededAttempts)}</td><td>{formatRate(day.completionRate)}</td><td>{day.provisional ? <HelpTerm content={t('analysis:provisionalResultsNotice')}>{t('analysis:provisional')}</HelpTerm> : t('analysis:confirmed')}</td></tr>)}</tbody></table></div></details>
    </section>}
    {panel === 'duration' && <WorkflowDuration duration={load.response.duration} provisional={provisional} />}
    {panel === 'failure' && <><WorkflowFailureReasons visual definition={load.definition} reasons={load.response.failureReasons} failed={load.response.summary.failedAttempts} provisional={provisional} />
      {compare && !comparisonError && <WorkflowFailureReasonComparison registry={registry} current={load} previous={previousLoad} status={comparisonStatus === 'ready' ? 'ready' : comparisonStatus === 'error' ? 'error' : 'loading'} />}</>}
    {panel === 'properties' && <WorkflowPropertyBreakdown client={client} registry={registry} definition={load.definition} range={range} previous={previous} context={context} onState={onState} />}
  </div>;
}
