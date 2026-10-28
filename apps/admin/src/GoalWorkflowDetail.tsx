import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ApiClient } from './api/client';
import type { Registry, WorkflowSummary } from './api/types';
import type { DateRange, WorkflowLoad } from './api/period-comparison';
import type { WorkflowGroupingState } from './api/workflow-analysis';
import { formatCount, formatRate } from './data';
import WorkflowDuration from './WorkflowDuration';
import WorkflowFailureReasons from './WorkflowFailureReasons';
import WorkflowFailureReasonComparison from './WorkflowFailureReasonComparison';
import WorkflowPropertyBreakdown from './WorkflowPropertyBreakdown';

type ComparisonProps = { load: WorkflowLoad; previousLoad?: WorkflowLoad; compare: boolean; comparisonError: string | null; comparisonStatus: string };
const fields = [['startedAttempts', '시작'], ['succeededAttempts', '성공'], ['failedAttempts', '확정 실패'], ['pendingAttempts', '대기'], ['completionRate', '완료율']] as const;

export function GoalWorkflowComparison({ load, previousLoad }: Pick<ComparisonProps, 'load' | 'previousLoad'>) {
  const current = load.response.summary, before = previousLoad?.response.summary;
  const metric = (value: number | null, rate: boolean) => rate ? formatRate(value) : value === null ? '—' : formatCount(value);
  const difference = (key: keyof WorkflowSummary) => {
    const now = current[key], prior = before?.[key];
    if (now === null || prior == null) return '—';
    const change = now - prior;
    return `${change > 0 ? '+' : ''}${key === 'completionRate' ? change.toFixed(1) : formatCount(change)}${key === 'completionRate' ? '%p' : '건'}`;
  };
  return <section className="goal-comparison"><h3>직전 기간 비교</h3>
    <p className="context-note">같은 일수의 직전 기간과 비교해요. 완료율 차이는 %p예요.</p>
    {!previousLoad && <p className="notice" role="status">직전 기간의 이 작업 흐름을 조회하지 못해 비교 수치를 표시하지 않아요.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label="작업 흐름 직전 기간 비교 표"><table className="event-table">
      <thead><tr><th scope="col">지표</th><th scope="col" className="number-cell">현재</th><th scope="col" className="number-cell">직전</th><th scope="col" className="number-cell">차이</th></tr></thead>
      <tbody>{fields.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td className="number-cell">{metric(current[key], key === 'completionRate')}</td><td className="number-cell">{metric(before?.[key] ?? null, key === 'completionRate')}</td><td className="number-cell">{difference(key)}</td></tr>)}</tbody>
    </table></div>
    {previousLoad && <p className="context-note">직전 {previousLoad.response.meta.from} ~ {previousLoad.response.meta.to}</p>}
    {(load.response.days.some(day => day.provisional) || previousLoad?.response.days.some(day => day.provisional)) && <p className="notice">집계 중인 시작일이 포함돼 결과가 달라질 수 있어요.</p>}
  </section>;
}

export default function GoalWorkflowDetail({ load, previousLoad, compare, comparisonError, comparisonStatus }: ComparisonProps) {
  const { definition, response } = load, counts = response.summary;
  const outcomes = fields.slice(0, 4), tones = ['', 'success', 'failure', 'pending'];
  return <section className="goal-section">
    <p className="goal-eyebrow">작업 흐름 / <code>{definition.id}</code></p>
    <div className="goal-header"><div><h2>{definition.label}</h2><p className="context-note">브라우저 메모리 작업 흐름 · 정의 v{response.meta.schemaVersion}</p></div>
      <div className="goal-ratio"><strong>{formatRate(counts.completionRate)}</strong><span>완료율 · {formatCount(counts.succeededAttempts)} / {formatCount(counts.startedAttempts)} 시도</span></div></div>
    <dl className="goal-outcomes">{outcomes.map(([key, label], index) => <div className={tones[index]} key={key}><dt>{label}</dt><dd>{counts[key] === null ? '—' : formatCount(counts[key]!)}</dd><span>{['시작한 시도', '완료된 시도', '실패로 확정된 시도', '결과를 기다리는 시도'][index]}</span></div>)}</dl>
    {counts.startedAttempts > 0 && <div className="goal-outcome-track" aria-hidden="true">{(['succeededAttempts', 'failedAttempts', 'pendingAttempts'] as const).map((key, index) => <span key={key} className={tones[index + 1]} style={{ width: `${(counts[key] ?? 0) / counts.startedAttempts * 100}%` }} />)}</div>}
    <p className="context-note">시작일 기준 · 대기는 확정 실패에 포함하지 않아요.{counts.failedAttempts === null && ' 실패 이벤트가 없어 확정 실패는 미측정이에요.'}{response.days.some(day => day.provisional) && ' 집계 중인 시작일이 포함돼 있어요.'}</p>
    {compare && !comparisonError && comparisonStatus === 'ready' && <GoalWorkflowComparison load={load} previousLoad={previousLoad} />}
    <details className="goal-definition"><summary>이벤트 정의 보기</summary><dl className="definition-list">
      <div><dt>시작</dt><dd>{definition.startEvent}</dd></div><div><dt>성공</dt><dd>{definition.successEvent}</dd></div><div><dt>실패</dt><dd>{definition.failureEvent ?? '등록 안 됨'}</dd></div>
    </dl></details>
  </section>;
}

export function GoalWorkflowAnalysis({ client, registry, load, previousLoad, range, previous, context, onState, compare, comparisonError, comparisonStatus }: ComparisonProps & {
  client: ApiClient; registry: Registry; range: DateRange; previous: DateRange | null; context: string;
  onState: (id: string, state: WorkflowGroupingState) => void;
}) {
  const [panel, setPanel] = useState('overview');
  const provisional = load.response.days.some(day => day.provisional);
  const tabs = [['overview', '현황'], ['failure', '실패 원인'], ['duration', '소요시간'], ['properties', '속성별 분석']];
  return <div className="goal-panel">
    <nav className="goal-tabs" aria-label="목표 상세 분석">{tabs.map(([key, label]) => <button type="button" key={key} aria-pressed={panel === key} onClick={() => {
      if (panel === 'properties' && key !== panel) onState(load.definition.id, { context, groupBy: '', status: 'idle' });
      setPanel(key);
    }}>{label}</button>)}</nav>
    {panel === 'overview' && <section><div className="section-header"><h3>일별 완료율</h3><span className="context-note">시작일 기준 코호트</span></div>
      <div className="goal-trend" role="img" aria-label={`${load.definition.label} 일별 완료율. 시작 시도가 없는 날은 비율을 표시하지 않아요.`}>
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={load.response.days} margin={{ top: 15, right: 20, left: 0, bottom: 5 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" /><XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} axisLine={false} tickLine={false} width={48} /><Tooltip formatter={value => typeof value === 'number' ? `${value.toFixed(1)}%` : '—'} />
          <Area type="linear" dataKey="completionRate" name="완료율" stroke="#155eef" fill="#eaf0ff" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </AreaChart></ResponsiveContainer>
      </div>
      <details><summary>일별 수치 보기</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="작업 흐름 일별 수치"><table className="event-table"><thead><tr><th scope="col">시작일</th><th scope="col">시작</th><th scope="col">성공</th><th scope="col">완료율</th><th scope="col">확정 상태</th></tr></thead><tbody>{load.response.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{formatCount(day.startedAttempts)}</td><td>{formatCount(day.succeededAttempts)}</td><td>{formatRate(day.completionRate)}</td><td>{day.provisional ? '집계 중' : '확정'}</td></tr>)}</tbody></table></div></details>
    </section>}
    {panel === 'duration' && <WorkflowDuration duration={load.response.duration} provisional={provisional} />}
    {panel === 'failure' && <><WorkflowFailureReasons visual definition={load.definition} reasons={load.response.failureReasons} failed={load.response.summary.failedAttempts} provisional={provisional} />
      {compare && !comparisonError && <WorkflowFailureReasonComparison registry={registry} current={load} previous={previousLoad} status={comparisonStatus === 'ready' ? 'ready' : comparisonStatus === 'error' ? 'error' : 'loading'} />}</>}
    {panel === 'properties' && <WorkflowPropertyBreakdown client={client} registry={registry} definition={load.definition} range={range} previous={previous} context={context} onState={onState} />}
  </div>;
}
