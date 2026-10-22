import { useId } from 'react';
import { compareFailureReasons } from './api/failure-reason-comparison';
import type { WorkflowLoad } from './api/period-comparison';
import type { Registry } from './api/types';
import { rangeLabel } from './api/dates';
import { formatCount, formatRate } from './data';

const count = (value: number | null) => value === null ? '—' : formatCount(value);
const change = (value: number | null) => {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)}%p`;
};
const coverage = { unavailable: '정보 없음', not_configured: '미설정', partial: '일부 측정', complete: '측정 완료', unmeasured: '전체 미측정', no_failed_attempts: '확정 실패 없음' };
const notices = {
  comparable: '', not_configured: '실패 원인 속성이 설정되지 않아 원인별 비교를 표시하지 않아요.',
  unavailable: '한쪽 기간에 실패 원인 측정 정보가 없어 원인 변화를 비교하지 않아요.',
  incomplete_measurement: '미측정 실패가 남아 있어 원인 변화 비교를 보류해요. 원인별 건수와 비중은 관측된 범위예요.',
  no_failed_attempts: '한쪽 기간에 확정 실패가 없어 원인 비중 차이를 계산하지 않아요.',
};
export default function WorkflowFailureReasonComparison({ registry, current, previous, status }: {
  registry: Registry; current: WorkflowLoad; previous?: WorkflowLoad; status: 'loading' | 'ready' | 'error';
}) {
  const heading = useId();
  const result = status === 'ready' && previous ? compareFailureReasons(current, previous, registry) : null;
  return <section className="workflow-failure-comparison" aria-labelledby={heading}>
    <h3 id={heading}>실패 원인 직전 기간 비교</h3>
    {!result ? <p role="status">{status === 'loading' ? '직전 기간의 실패 원인을 조회하는 중이에요.' : '직전 기간을 읽지 못해 실패 원인을 비교할 수 없어요. 위의 비교 다시 시도를 눌러 주세요.'}</p>
      : <>
        <p className="context-note">현재 {rangeLabel(result.range.from, result.range.to)} · 직전 {rangeLabel(result.previousRange.from, result.previousRange.to)}</p>
        <p className="context-note">전체 실패율은 확정 실패 ÷ 시작 시도예요. 원인 비중의 상승만으로 전체 실패가 늘었다고 판단하지 않아요. 대기 시도는 나중에 실패로 확정될 수 있어요.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="전체 실패율 직전 기간 비교"><table className="event-table">
          <thead><tr><th scope="col">지표</th><th scope="col">현재</th><th scope="col">직전</th><th scope="col">차이</th></tr></thead>
          <tbody><tr><th scope="row">전체 실패율</th><td>{formatRate(result.currentFailureRate)}</td><td>{formatRate(result.previousFailureRate)}</td><td>{change(result.failureRateChange)}</td></tr>
            <tr><th scope="row">확정 실패 / 시작 시도</th><td>{count(result.currentSummary.failedAttempts)} / {count(result.currentSummary.startedAttempts)}</td>
              <td>{count(result.previousSummary.failedAttempts)} / {count(result.previousSummary.startedAttempts)}</td><td>—</td></tr></tbody>
        </table></div>
        {result.provisional && <p className="context-note" role="status">집계 중인 시작일 코호트가 포함돼 있어요. 지금 표시한 건수·비율·차이는 이후 바뀔 수 있어요.</p>}
        <p className="context-note">원인 측정: 현재 {coverage[result.currentCoverage]} · 직전 {coverage[result.previousCoverage]}</p>
        {notices[result.status] && <p role="status">{notices[result.status]}</p>}
        {result.rows.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="실패 원인 직전 기간 비교 표"><table className="event-table">
          <thead><tr><th scope="col">원인</th><th scope="col">현재 실패</th><th scope="col">직전 실패</th><th scope="col">현재 비중</th><th scope="col">직전 비중</th><th scope="col">비중 차이</th></tr></thead>
          <tbody>{result.rows.map(row => <tr key={`${row.kind}:${row.value}`}><th scope="row">{row.kind === 'enum' ? row.value : row.kind === 'missing' ? '원인 누락' : '미측정'}</th>
            <td>{count(row.currentCount)}</td><td>{count(row.previousCount)}</td><td>{formatRate(row.currentShare)}</td><td>{formatRate(row.previousShare)}</td><td>{change(row.shareChange)}</td></tr>)}</tbody>
        </table></div>}
        <p className="context-note">원인 비중의 분모는 각 기간의 전체 확정 실패예요. 두 기간 모두 원인을 측정했을 때 비중 차이(%p)를 계산해요. 정보가 없는 값은 —로 남겨요.</p>
      </>}
  </section>;
}
