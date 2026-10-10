import type { ApiClient } from './api/client';
import type { Registry } from './api/types';
import type { DateRange, WorkflowLoad } from './api/period-comparison';
import type { WorkflowGroupingState } from './api/workflow-analysis';
import { formatCount, formatRate } from './data';
import WorkflowPropertyBreakdown from './WorkflowPropertyBreakdown';
import LiveFunnels from './LiveFunnels';

export default function LiveGoals({ client, registry, workflows, range, previous, context, onState }: {
  client: ApiClient; registry: Registry; workflows: WorkflowLoad[]; range: DateRange; previous: DateRange | null;
  context: string; onState: (id: string, state: WorkflowGroupingState) => void;
}) {
  return <>
      {(workflows.length === 0 && !(registry.funnels?.length)
        ? <section className="state-panel" role="status"><h2>등록된 작업 흐름이 없어요</h2><p>이 스키마에는 완료율을 계산할 작업 흐름 정의가 없어요.</p></section>
        : workflows.map(load => <section className="goal-section" key={load.definition.id}>
          <div className="goal-header"><div><h2>{load.definition.label}</h2><p className="context-note">시작일 기준 코호트({load.response.cohortBasis}) · 정의 v{registry.schemaVersion}</p></div><div className="goal-ratio"><strong>{formatRate(load.response.summary.completionRate)}</strong><span>{formatCount(load.response.summary.succeededAttempts)} / {formatCount(load.response.summary.startedAttempts)}</span></div></div>
          {load.response.summary.completionRate !== null && <progress className="goal-track" max={100} value={load.response.summary.completionRate} aria-label={`${load.definition.label} 완료율`} />}
          <dl className="definition-list">
            <div><dt>시작</dt><dd>{load.definition.startEvent}<span>{formatCount(load.response.summary.startedAttempts)}건</span></dd></div>
            <div><dt>성공</dt><dd>{load.definition.successEvent}<span>{formatCount(load.response.summary.succeededAttempts)}건</span></dd></div>
            <div><dt>실패</dt><dd>{load.definition.failureEvent ?? '등록 안 됨'}<span>{load.response.summary.failedAttempts === null ? '—' : `${formatCount(load.response.summary.failedAttempts)}건`}</span></dd></div>
            <div><dt>대기</dt><dd>pending<span>{formatCount(load.response.summary.pendingAttempts)}건</span></dd></div>
          </dl>
          <p className="context-note">완료율과 시도 수는 작업 흐름 응답에서 그대로 가져와요. 이벤트 총수로 완료율을 추론하지 않아요.</p>
          <WorkflowPropertyBreakdown key={`${context}:${load.definition.id}`} client={client} registry={registry} definition={load.definition} range={range} previous={previous} context={context} onState={onState} />
        </section>))}
    <LiveFunnels client={client} registry={registry} range={range} context={context} />
  </>;
}
