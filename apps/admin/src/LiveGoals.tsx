import { useState } from 'react';
import { Funnel, ListChecks, MagnifyingGlass } from '@phosphor-icons/react';
import WorkflowFailurePanel from './WorkflowFailurePanel';
import type { ApiClient } from './api/client';
import type { Load } from './api/load-state';
import type { Registry } from './api/types';
import type { DateRange, PeriodSnapshot, WorkflowLoad, WorkflowFailure } from './api/period-comparison';
import type { WorkflowGroupingState } from './api/workflow-analysis';
import { formatRate } from './data';
import LiveFunnels from './LiveFunnels';
import GoalWorkflowDetail, { GoalWorkflowAnalysis } from './GoalWorkflowDetail';
import './event-shell.css';
import './goal-workspace.css';

export default function LiveGoals({ client, registry, workflows, workflowErrors, onRecovered, range, previous, context, onState, compare, comparisonError, periodComparison }: {
  client: ApiClient; registry: Registry; workflows: WorkflowLoad[]; range: DateRange; previous: DateRange | null;
  workflowErrors: WorkflowFailure[]; onRecovered: (load: WorkflowLoad) => void;
  context: string; onState: (id: string, state: WorkflowGroupingState) => void;
  compare: boolean; comparisonError: string | null; periodComparison?: Load<PeriodSnapshot>;
}) {
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
  if (!goals.length) return <section className="state-panel" role="status"><h2>등록된 목표가 없어요</h2><p>설정에서 작업 흐름이나 퍼널을 등록하면 완료율과 단계별 도달을 확인할 수 있어요.</p></section>;
  return <div className="goal-workspace">
    <aside className="goal-explorer" aria-label="목표 탐색기">
      <h2>목표 탐색기</h2>
      <label className="goal-search"><MagnifyingGlass size={18} aria-hidden="true" /><span className="sr-only">목표 이름 검색</span>
        <input type="search" placeholder="목표 이름 또는 ID 검색" value={query} onChange={event => setSearch({ scope, value: event.target.value })} /></label>
      {(['workflow', 'funnel'] as const).map(kind => <div key={kind}>
        <h3 className="goal-group-heading">{kind === 'workflow' ? <ListChecks size={17} /> : <Funnel size={17} />}{kind === 'workflow' ? '작업 흐름' : '퍼널'} <span>{goals.filter(goal => goal.kind === kind).length}</span></h3>
        <ul className="goal-list">{matches.filter(goal => goal.kind === kind).map(goal => <li key={goal.key}>
          <button type="button" className="goal-option" aria-label={goal.definition.label} aria-pressed={active?.key === goal.key} onClick={() => choose(goal.key)}>
            <span className="goal-option-label">{goal.definition.label}</span><span className="goal-option-key">{goal.definition.id}</span>
            <strong className="goal-option-rate">{goal.kind === 'workflow' ? formatRate(loaded.get(goal.definition.id)?.response.summary.completionRate ?? null) : `${goal.definition.steps.length}단계`}</strong>
            {goal.kind === 'workflow' && failed.has(goal.definition.id) && <span className="form-error">조회 실패</span>}
          </button>
        </li>)}</ul>
      </div>)}
      {!matches.length && <p className="context-note" role="status">검색 결과가 없어요. 다른 이름이나 ID를 입력해 주세요.</p>}
      <p className="goal-explorer-footer">작업 흐름 {registry.workflows.length}개 · 퍼널 {registry.funnels?.length ?? 0}개</p>
    </aside>
    <div className="goal-inspector" key={`${scope}:${active?.key}`}>
      {failure ? <WorkflowFailurePanel client={client} registry={registry} range={range} failure={failure} onRecovered={onRecovered} />
        : selectedLoad ? <><GoalWorkflowDetail load={selectedLoad} previousLoad={before} compare={compare} comparisonError={comparisonError} comparisonStatus={periodComparison?.status ?? 'idle'} />
          <GoalWorkflowAnalysis client={client} registry={registry} load={selectedLoad} previousLoad={before} range={range} previous={previous} context={context} onState={onState} compare={compare} comparisonError={comparisonError} comparisonStatus={periodComparison?.status ?? 'idle'} /></>
        : active?.kind === 'workflow' ? <p role="status">작업 흐름을 조회하는 중이에요.</p> : null}
      {active?.kind === 'funnel' && <LiveFunnels key={active.definition.id} client={client} registry={registry} range={range} context={context} previous={previous} compare={compare} comparisonError={comparisonError} selectedFunnelId={active.definition.id} />}
    </div>
  </div>;
}
