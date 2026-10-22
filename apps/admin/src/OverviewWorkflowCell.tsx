import type { ServiceRow } from './api/project-overview';
import { workflowComparison } from './api/overview-workflow';
import type { WorkflowSample } from './api/overview-workflow';
import { formatCount, formatRate } from './data';

function Sample({ label, sample }: { label: string; sample: WorkflowSample }) {
  return <div>{label} 성공 {formatCount(sample.succeededAttempts)} / 시작 {formatCount(sample.startedAttempts)}
    {' · '}진행 중 {formatCount(sample.pendingAttempts)}{sample.failedAttempts !== null && ` · 실패 ${formatCount(sample.failedAttempts)}`}
    {sample.provisional && ' · 집계 중'}</div>;
}
export default function OverviewWorkflowCell({ row }: { row: ServiceRow }) {
  if (row.workflowUnavailable) return <>완료율 조회 실패</>;
  const comparison = workflowComparison(row.workflowStats, row.completion, row.previousCompletion);
  return <>{row.version === null ? '활성 스키마 없음' : row.workflowLabel ?? '작업 흐름 없음'}
    <div>{formatRate(row.completion)} / {comparison.delta === null ? '비교 불가' : `${comparison.delta.toFixed(1)}%p`}</div>
    {row.workflowStats && <><Sample label="현재" sample={row.workflowStats.current} /><Sample label="직전" sample={row.workflowStats.previous} /></>}
    {row.workflowLabel && <div>{comparison.reason}</div>}</>;
}
