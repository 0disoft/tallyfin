import { useId } from 'react';
import type { FailureReasons } from './api/workflow-failure-reasons';
import type { WorkflowDefinition } from './api/types';
import { formatCount, formatRate } from './data';

export default function WorkflowFailureReasons({ definition, reasons, failed, provisional }: {
  definition: WorkflowDefinition; reasons: FailureReasons | null | undefined; failed: number | null; provisional: boolean;
}) {
  const heading = useId();
  const empty = definition.failureEvent === null ? '실패 이벤트가 없는 작업 흐름이에요.'
    : !definition.failureReasonProperty ? '실패 원인을 집계하려면 설정에서 실패 이벤트의 enum 속성을 선택하고 새 버전을 발행하세요.'
    : !reasons ? '이 응답에는 실패 원인 측정 정보가 없어요.'
    : !failed ? '실패 원인을 표시할 확정 실패가 없어요.'
    : reasons.measuredFailures === 0 ? '실패 기록은 있지만 원인은 미측정이에요.' : null;
  return <section className="workflow-failure-reasons" aria-labelledby={heading}>
    <h3 id={heading}>실패 원인</h3>
    <p className="context-note">시작과 실패가 모두 확인된 시도의 최초 실패 원인이에요. 비율은 원인 누락과 미측정을 포함한 전체 확정 실패를 기준으로 계산해요.</p>
    {reasons && <p className="context-note">속성 {reasons.property} · 측정 {formatCount(reasons.measuredFailures)}건 · 원인 누락 {formatCount(reasons.missingReasonFailures)}건 · 미측정 실패 {formatCount(reasons.unmeasuredFailures)}건{provisional && ' · 집계 중'}</p>}
    {reasons && reasons.unmeasuredFailures > 0 && <p className="context-note">측정 도입 전 등 원인이 남아 있지 않은 실패가 있어요. 미측정 건수만큼 표의 비율 합계가 100%보다 작을 수 있어요.</p>}
    {empty ? <p role="status">{empty}</p> : reasons && <div className="table-scroll" tabIndex={0} role="region" aria-label="실패 원인 분포"><table className="event-table">
      <thead><tr><th scope="col">원인</th><th scope="col">실패</th><th scope="col">전체 확정 실패 중 비중</th></tr></thead>
      <tbody>{[...reasons.buckets, { value: '원인 누락', failedAttempts: reasons.missingReasonFailures }].map((bucket, index) =>
        <tr key={index}><th scope="row">{bucket.value}</th><td>{formatCount(bucket.failedAttempts)}</td>
          <td>{failed ? formatRate(bucket.failedAttempts / failed * 100) : '—'}</td></tr>)}</tbody>
    </table></div>}
  </section>;
}
