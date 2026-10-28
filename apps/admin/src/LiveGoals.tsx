import { useState } from 'react';
import { Funnel, ListChecks, MagnifyingGlass } from '@phosphor-icons/react';
import WorkflowFailurePanel from './WorkflowFailurePanel';
import type { ApiClient } from './api/client';
import type { Load } from './api/load-state';
import type { Registry } from './api/types';
import type { DateRange, PeriodSnapshot, WorkflowLoad, WorkflowFailure } from './api/period-comparison';
import type { WorkflowGroupingState } from './api/workflow-analysis';
import LiveFunnels from './LiveFunnels';
import GoalWorkflowDetail, { GoalWorkflowAnalysis } from './GoalWorkflowDetail';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import './event-shell.css';
import './goal-workspace.css';

export default function LiveGoals({ client, registry, workflows, workflowErrors, onRecovered, range, previous, context, onState, compare, comparisonError, periodComparison }: {
  client: ApiClient; registry: Registry; workflows: WorkflowLoad[]; range: DateRange; previous: DateRange | null;
  workflowErrors: WorkflowFailure[]; onRecovered: (load: WorkflowLoad) => void;
  context: string; onState: (id: string, state: WorkflowGroupingState) => void;
  compare: boolean; comparisonError: string | null; periodComparison?: Load<PeriodSnapshot>;
}) {
  const { t } = useI18n();
  const { rate: formatRate } = useLocaleFormat();
  const [selection, setSelection] = useState<{ scope: string; key: string } | null>(null);
  const [search, setSearch] = useState({ scope: '', value: '' });
  const scope = JSON.stringify([registry.project.id, registry.schemaVersion, context]);
  const query = search.scope === scope ? search.value : '';
  const goals = [...registry.workflows.map(definition => ({ key: `workflow:${definition.id}`, kind: 'workflow', definition } as const)),
    ...(registry.funnels ?? []).map(definition => ({ key: `funnel:${definition.id}`, kind: 'funnel', definition } as const))];
  const active = goals.find(goal => selection?.scope === scope && goal.key === selection.key) ?? goals[0];
  const loaded = new Map(workflows.map(load => [load.definition.id, load]));
  const failed = new Map(workflowErrors.map(failure => [failure.definition.id, failure]));
  const before = periodComparison?.status === 'ready' ? periodComparison.data?.workflows.find(load => load.definition.id === active?.definition.id) : undefined;
  const matches = goals.filter(goal => `${goal.definition.label} ${goal.definition.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectedLoad = active?.kind === 'workflow' ? loaded.get(active.definition.id) : undefined;
  const failure = active?.kind === 'workflow' ? failed.get(active.definition.id) : undefined;
  const choose = (key: string) => {
    if (active?.key === key) return;
    // The old property component unmounts on selection: discard its CSV detail too.
    if (active?.kind === 'workflow') onState(active.definition.id, { context, groupBy: '', status: 'idle' });
    setSelection({ scope, key });
  };
  if (!goals.length) return <section className="state-panel" role="status"><h2>{t('analysis:noGoalsTitle')}</h2><p>{t('analysis:noGoalsBody')}</p></section>;
  return <div className="goal-workspace">
    <aside className="goal-explorer" aria-label={t('analysis:goalExplorer')}>
      <h2>{t('analysis:goalExplorer')}</h2>
      <label className="goal-search"><MagnifyingGlass size={18} aria-hidden="true" /><span className="sr-only">{t('analysis:searchGoals')}</span>
        <input type="search" placeholder={t('analysis:goalSearchPlaceholder')} value={query} onChange={event => setSearch({ scope, value: event.target.value })} /></label>
      {(['workflow', 'funnel'] as const).map(kind => <div key={kind}>
        <h3 className="goal-group-heading">{kind === 'workflow' ? <ListChecks size={17} /> : <Funnel size={17} />}{kind === 'workflow' ? t('analysis:workflow') : t('analysis:funnel')} <span>{goals.filter(goal => goal.kind === kind).length}</span></h3>
        <ul className="goal-list">{matches.filter(goal => goal.kind === kind).map(goal => <li key={goal.key}>
          <button type="button" className="goal-option" aria-label={goal.definition.label} aria-pressed={active?.key === goal.key} onClick={() => choose(goal.key)}>
            <span className="goal-option-label">{goal.definition.label}</span><span className="goal-option-key">{goal.definition.id}</span>
            <strong className="goal-option-rate">{goal.kind === 'workflow' ? formatRate(loaded.get(goal.definition.id)?.response.summary.completionRate ?? null) : t('analysis:stageCount', { count: goal.definition.steps.length })}</strong>
            {goal.kind === 'workflow' && failed.has(goal.definition.id) && <span className="form-error">{t('analysis:loadFailed')}</span>}
          </button>
        </li>)}</ul>
      </div>)}
      {!matches.length && <p className="context-note" role="status">{t('analysis:noGoalResults')}</p>}
      <p className="goal-explorer-footer">{t('analysis:goalExplorerFooter', { workflows: registry.workflows.length, funnels: registry.funnels?.length ?? 0 })}</p>
    </aside>
    <div className="goal-inspector" key={`${scope}:${active?.key}`}>
      {failure ? <WorkflowFailurePanel client={client} registry={registry} range={range} failure={failure} onRecovered={onRecovered} />
        : selectedLoad ? <><GoalWorkflowDetail load={selectedLoad} previousLoad={before} compare={compare} comparisonError={comparisonError} comparisonStatus={periodComparison?.status ?? 'idle'} />
          <GoalWorkflowAnalysis client={client} registry={registry} load={selectedLoad} previousLoad={before} range={range} previous={previous} context={context} onState={onState} compare={compare} comparisonError={comparisonError} comparisonStatus={periodComparison?.status ?? 'idle'} /></>
        : active?.kind === 'workflow' ? <p role="status">{t('analysis:loadingWorkflow')}</p> : null}
      {active?.kind === 'funnel' && <LiveFunnels key={active.definition.id} client={client} registry={registry} range={range} context={context} previous={previous} compare={compare} comparisonError={comparisonError} selectedFunnelId={active.definition.id} />}
    </div>
  </div>;
}
