import type { DiagnosticRead } from './api/collection-diagnostics.ts';
import { REJECTION_LABELS, type RejectionResponse } from './api/rejection-diagnostics.ts';
import { formatCount } from './data.ts';

const utcTime = (value: string) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium',
}).format(new Date(value));
function RecordedTime({ value }: { value: string | null }) {
  return value === null ? <>기록 없음</> : <time dateTime={value}>{utcTime(value)}</time>;
}

export default function CollectionRejections({ read }: { read: DiagnosticRead<RejectionResponse> }) {
  const data = read.value;
  return <section className="collection-rejections" aria-labelledby="collection-rejections-heading">
    <h3 id="collection-rejections-heading" className="settings-subheading">최근 7일 수집 거부 기록</h3>
    <p className="context-note">프로젝트 전체 · UTC 수신일 기준. 저장된 거부 요청만 집계해요. 한 요청에 여러 이벤트가 있어도 거부는 1건이에요.</p>
    {read.error ? <p className="form-error" role="alert">거부 기록 조회 실패: {read.error.message} 위의 ‘수집 상태 다시 확인’으로 다시 조회할 수 있어요.</p> : data && <>
      <dl className="diagnostic-facts">
        <div><dt>기록된 거부 요청</dt><dd>{formatCount(data.summary.rejectedRequests)}건</dd></div>
        <div><dt>마지막 거부 · UTC</dt><dd><RecordedTime value={data.summary.lastRejectedAt} /></dd></div>
      </dl>
      <p className="field-help">{data.meta.from} ~ {data.meta.to} · 조회 시각 {utcTime(data.meta.generatedAt)} UTC. 기록 저장에 실패하거나 집계 도입 전인 이력은 빠질 수 있어요. 이 건수로 전체 거부율이나 남은 한도를 계산하지 않아요.</p>
      {data.summary.rejectedRequests === 0 && <p role="status">이 기간에 기록된 거부 요청이 없어요.</p>}
      <details className="rejection-details"><summary>원인별 기록 보기</summary>
        <div className="rejection-table-scroll" tabIndex={0} role="region" aria-label="거부 원인 표">
          <table><caption>최근 7일 원인별 거부 요청 · 시각은 UTC</caption>
            <thead><tr><th scope="col">원인</th><th scope="col">건수</th><th scope="col">마지막 거부</th></tr></thead>
            <tbody>{data.summary.reasons.map(row => <tr key={row.reason}><th scope="row">{REJECTION_LABELS[row.reason]}</th>
              <td>{formatCount(row.count)}</td><td><RecordedTime value={row.lastRejectedAt} /></td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <details className="rejection-details"><summary>일별 기록 보기</summary>
        <div className="rejection-table-scroll" tabIndex={0} role="region" aria-label="일별 거부 표">
          <table><caption>UTC 날짜별 거부 요청 · 최근 날짜부터 표시</caption>
            <thead><tr><th scope="col">날짜</th><th scope="col">건수</th><th scope="col">마지막 거부</th></tr></thead>
            <tbody>{[...data.days].reverse().map(row => <tr key={row.date}><th scope="row">{row.date}</th>
              <td>{formatCount(row.rejectedRequests)}</td><td><RecordedTime value={row.lastRejectedAt} /></td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>}
  </section>;
}
