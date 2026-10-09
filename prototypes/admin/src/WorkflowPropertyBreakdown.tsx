import { useEffect, useId, useState } from 'react';
import { ApiClient } from './api/client';
import type { DateRange } from './api/period-comparison';
import type { Registry, WorkflowBreakdownResponse, WorkflowDefinition } from './api/types';
import { validateWorkflowBreakdown, workflowValueLabel, type WorkflowGroupingState } from './api/workflow-analysis';
import { formatCount, formatRate } from './data';

export default function WorkflowPropertyBreakdown({ client, registry, definition, range, context, onState }: {
  client: ApiClient; registry: Registry; definition: WorkflowDefinition; range: DateRange; context: string;
  onState: (workflowId: string, state: WorkflowGroupingState) => void;
}) {
  const id = useId(), [groupBy, setGroupBy] = useState(''), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; data?: WorkflowBreakdownResponse }>({ key: '', status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const key = JSON.stringify([context, definition.id, groupBy, retry]);
  const current = result.key === key ? result : null;
  const choose = (value: string) => {
    setGroupBy(value); setSelected(null);
    onState(definition.id, { context, groupBy: value, status: value ? 'loading' : 'idle' });
  };
  useEffect(() => {
    if (!groupBy) return;
    const controller = new AbortController();
    setResult({ key, status: 'loading' });
    onState(definition.id, { context, groupBy, status: 'loading' });
    client.getWorkflowBreakdown(registry.project.id, definition.id, { schemaVersion: registry.schemaVersion,
      ...range, groupBy, signal: controller.signal })
      .then(data => {
        validateWorkflowBreakdown(data, registry, range, definition.id, groupBy);
        if (controller.signal.aborted) return;
        setResult({ key, status: 'ready', data }); onState(definition.id, { context, groupBy, status: 'ready', data });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult({ key, status: 'error' }); onState(definition.id, { context, groupBy, status: 'error' });
      });
    return () => controller.abort();
  }, [client, registry, definition, range, context, groupBy, key, onState]);
  const buckets = current?.status === 'ready' ? [...current.data!.buckets].sort((a, b) => b.summary.startedAttempts - a.summary.startedAttempts) : [];
  const active = buckets.find(bucket => JSON.stringify(bucket.value) === selected);
  const cells = (value: WorkflowBreakdownResponse['summary']) => <><td className="number-cell">{formatCount(value.startedAttempts)}</td><td className="number-cell">{formatCount(value.succeededAttempts)}</td><td className="number-cell">{value.failedAttempts === null ? '—' : formatCount(value.failedAttempts)}</td><td className="number-cell">{formatCount(value.pendingAttempts)}</td><td className="number-cell">{formatRate(value.completionRate)}</td></>;
  const headings = <><th scope="col" className="number-cell">시작</th><th scope="col" className="number-cell">성공</th><th scope="col" className="number-cell">실패</th><th scope="col" className="number-cell">대기</th><th scope="col" className="number-cell">완료율</th></>;
  return <section className="workflow-property-analysis" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>속성별 완료율</h3>
    <label className="api-field property-grouping" htmlFor={`${id}-group`}><span>시작 시점 분류 기준</span><select id={`${id}-group`} className="text-input settings-select" value={groupBy} onChange={event => choose(event.target.value)} disabled={!definition.dimensions.length}>
      <option value="">분류 안 함</option>{definition.dimensions.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <p className="context-note">{definition.dimensions.length ? '각 값의 성공 시도 ÷ 시작 시도로 계산해요. 현재 기간만 분류하며 이전 기간 속성 비교는 아직 없어요.' : '등록된 시작 시점 비교 속성이 없어요. 스키마의 작업 흐름 비교 기준에서 추가할 수 있어요.'}</p>
    {groupBy && (!current || current.status === 'loading') && <p role="status">속성별 완료율을 조회하는 중이에요.</p>}
    {groupBy && current?.status === 'error' && <div role="alert"><p>속성별 완료율을 불러오지 못했어요. 전체 목표 결과는 유지돼요.</p><button className="secondary-button" type="button" onClick={() => { onState(definition.id, { context, groupBy, status: 'loading' }); setRetry(value => value + 1); }}>속성별 조회 다시 시도</button></div>}
    {groupBy && current?.status === 'ready' && (buckets.length === 0 ? <p role="status">선택 기간에 관찰된 속성 값이 없어요.</p> : <>
      <div className="table-scroll" tabIndex={0} aria-label={`${definition.label} 속성별 완료율 표`}><table className="event-table"><caption className="sr-only">{groupBy} 시작 시점 값별 완료율</caption><thead><tr><th scope="col">{groupBy} 값 · 일별 보기</th>{headings}</tr></thead><tbody>{buckets.map(bucket => <tr key={JSON.stringify(bucket.value)}><th scope="row"><button className="text-button" type="button" aria-pressed={selected === JSON.stringify(bucket.value)} onClick={() => setSelected(JSON.stringify(bucket.value))}>{workflowValueLabel(bucket.value)}</button></th>{cells(bucket.summary)}</tr>)}</tbody></table></div>
      <p className="context-note">시작이 0이면 완료율은 알 수 없음(—)이에요. 실패 단계가 없으면 실패 수는 —로 표시해요. 확정 전 시작일 코호트는 완료율이 바뀔 수 있어요.</p>
      {active && <><h4>{groupBy} · {workflowValueLabel(active.value)} 일별 내역</h4><div className="table-scroll" tabIndex={0} aria-label={`${definition.label} 속성 값 일별 내역`}><table className="event-table"><caption className="sr-only">선택한 속성 값의 시작일별 수치</caption><thead><tr><th scope="col">시작일</th>{headings}<th scope="col">확정 상태</th></tr></thead><tbody>{active.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th>{cells(day)}<td>{day.provisional ? '집계 중' : '확정'}</td></tr>)}</tbody></table></div></>}
    </>)}
  </section>;
}
