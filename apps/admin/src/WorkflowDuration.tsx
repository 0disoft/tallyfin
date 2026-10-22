import { useId } from 'react';
import type { WorkflowDuration as Duration } from './api/workflow-duration';
import { DURATION_RANGES } from './api/workflow-duration';
import { formatCount, formatRate } from './data';

export default function WorkflowDuration({ duration, provisional }: { duration: Duration | undefined; provisional: boolean }) {
  const heading = useId();
  return <section className="workflow-duration" aria-labelledby={heading}>
    <h3 id={heading}>완료 소요시간</h3>
    <p className="context-note">시작과 종료가 모두 확인된 시도의 브라우저 시각 차이예요. 서버 처리시간과 다르며 대기 중인 시도는 제외해요.</p>
    {!duration ? <p role="status">이 응답에는 소요시간 측정 정보가 없어요.</p>
      : <><p className="context-note">측정 {formatCount(duration.measuredAttempts)}건 · 미측정 완료 {formatCount(duration.unmeasuredAttempts)}건{provisional && ' · 집계 중'}</p>
        {duration.unmeasuredAttempts > 0 && <p className="context-note">측정 도입 전 등 시간이 남아 있지 않은 완료는 분포와 비율에서 제외해요.</p>}
        {duration.measuredAttempts === 0 ? <p role="status">{duration.unmeasuredAttempts > 0 ? '완료 기록은 있지만 소요시간은 미측정이에요.' : '소요시간을 표시할 완료 시도가 없어요.'}</p>
          : <div className="table-scroll" tabIndex={0} role="region" aria-label="완료 소요시간 분포"><table className="event-table"><thead><tr><th scope="col">시간 구간</th><th scope="col">성공</th><th scope="col">실패</th><th scope="col">측정 완료 중 비중</th></tr></thead>
            <tbody>{duration.buckets.map((bucket, index) => <tr key={bucket.range}><th scope="row">{DURATION_RANGES[index]![1]}</th>
              <td>{formatCount(bucket.succeededAttempts)}</td><td>{bucket.failedAttempts === null ? '—' : formatCount(bucket.failedAttempts)}</td>
              <td>{formatRate((bucket.succeededAttempts + (bucket.failedAttempts ?? 0)) / duration.measuredAttempts * 100)}</td></tr>)}</tbody></table></div>}
      </>}
  </section>;
}
