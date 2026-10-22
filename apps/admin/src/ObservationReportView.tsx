import { useState } from 'react';
import type { ObservationReport } from './api/observation-report.ts';
import { formatCount } from './data.ts';
import './observation-report.css';

type Diagnostics = NonNullable<ObservationReport['diagnostics']>;
type Finding = Diagnostics['findings'][number];
const CLEANUP_REASONS = { page_limit: '이번 실행의 페이지 한도', time_budget: '실행 시간 한도', cycle_complete: '순회 중복 도달',
  empty_page: '조회할 프로젝트 없음', cursor_conflict: '커서 갱신 충돌', cancelled: '취소·실행 기한 만료', storage_error: '저장소 오류' };

const RESPONSE_PAGE_SIZE = 25;

const OPERATION_LABELS: Record<Finding['operation'], string> = {
  browser_collection: '브라우저 수집',
  server_collection: '서버 수집',
  administrator: '관리자',
  other: '기타',
  retention_cleanup: '보존 정리',
};
const SEVERITY_LABELS: Record<Finding['severity'], string> = { error: '오류', review: '확인 필요' };
const UNIT_LABELS: Record<Finding['unit'], string> = { responses: '응답', runs: '실행' };
const ACTION_LABELS: Record<Finding['action'], string> = {
  inspect_storage: '저장소 점검',
  inspect_collector: '수집기 점검',
  review_collection_limits: '수집 한도 확인',
  review_collection_configuration: '수집 설정 확인',
  review_access_configuration: '접근 설정 확인',
  review_request_contract: '요청 계약 확인',
  inspect_retention_cleanup: '보존 정리 점검',
  inspect_cleanup_log_coverage: '정리 로그 범위 점검',
};
const BUCKET_LABELS: Record<string, string> = {
  lt_10ms: '0ms 이상 10ms 미만',
  lt_50ms: '10ms 이상 50ms 미만',
  lt_250ms: '50ms 이상 250ms 미만',
  lt_1000ms: '250ms 이상 1,000ms 미만',
  gte_1000ms: '1,000ms 이상',
  unknown: '측정 못함',
};
const bucketLabel = (bucket: string) => BUCKET_LABELS[bucket] ?? bucket;
const severityClass = (severity: Finding['severity']) =>
  severity === 'error' ? 'observation-severity-error' : 'observation-severity-review';

function ObservationOperation({ operation, page, onPage }: {
  operation: ObservationReport['operations'][number]; page: number; onPage: (page: number) => void;
}) {
  const rows = operation.responses;
  const pageCount = Math.max(1, Math.ceil(rows.length / RESPONSE_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * RESPONSE_PAGE_SIZE;
  const visible = rows.slice(start, start + RESPONSE_PAGE_SIZE);
  const label = OPERATION_LABELS[operation.operation];
  return <article className="observation-operation">
    <div className="observation-operation-head">
      <h4>{label}</h4>
      <code className="observation-operation-code">{operation.operation}</code>
    </div>
    <dl className="observation-facts">
      <div><dt>관측 응답</dt><dd>{formatCount(operation.observedResponses)}줄</dd></div>
      <div><dt>어림 요청 수</dt><dd>약 {formatCount(operation.weightedRequestsEstimate)}건</dd></div>
    </dl>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${label} 응답 표`}>
      <table className="event-table observation-table">
        <caption className="sr-only">{label} 운영의 상태·코드별 관측 응답 줄 수와 어림 요청 수</caption>
        <thead><tr><th scope="col">상태</th><th scope="col">코드</th>
          <th scope="col" className="number-cell">관측 응답</th><th scope="col" className="number-cell">어림 요청 수</th></tr></thead>
        <tbody>{visible.map(row => <tr key={`${row.status}:${row.code}`}>
          <th scope="row">{row.status}</th>
          <td><code>{row.code}</code></td>
          <td className="number-cell">{formatCount(row.observedResponses)}</td>
          <td className="number-cell">약 {formatCount(row.weightedRequestsEstimate)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pageCount > 1 && <div className="observation-pager">
      <button className="secondary-button" type="button" disabled={current === 0} onClick={() => onPage(current - 1)}>이전 {RESPONSE_PAGE_SIZE}줄</button>
      <p className="observation-page-status" role="status">{current + 1}/{pageCount}쪽 · {formatCount(start + 1)}–{formatCount(start + visible.length)}번째 · 전체 {formatCount(rows.length)}줄</p>
      <button className="secondary-button" type="button" disabled={current >= pageCount - 1} onClick={() => onPage(current + 1)}>다음 {RESPONSE_PAGE_SIZE}줄</button>
    </div>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${label} 지연 구간 표`}>
      <table className="event-table observation-table">
        <caption className="sr-only">{label} 운영의 지연 구간별 관측 응답 줄 수와 어림 요청 수</caption>
        <thead><tr><th scope="col">지연 구간</th>
          <th scope="col" className="number-cell">관측 응답</th><th scope="col" className="number-cell">어림 요청 수</th></tr></thead>
        <tbody>{operation.latencyBuckets.map(row => <tr key={row.bucket}>
          <th scope="row">{bucketLabel(row.bucket)}</th>
          <td className="number-cell">{formatCount(row.observedResponses)}</td>
          <td className="number-cell">약 {formatCount(row.weightedRequestsEstimate)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </article>;
}

/** Read-only view of the CLI observation summary. The parent panel owns the file reader and scope note. */
export default function ObservationReportView({ report }: { report: ObservationReport }) {
  // Page state is bound to the report object, so a new report always starts back at the first page.
  const [paging, setPaging] = useState<{ report: ObservationReport; pages: Record<string, number> }>({ report, pages: {} });
  const pages = paging.report === report ? paging.pages : {};
  const changePage = (operation: string, page: number) => setPaging(current => ({
    report, pages: { ...(current.report === report ? current.pages : {}), [operation]: page },
  }));
  const diagnostics = report.diagnostics;
  const findings = diagnostics?.findings ?? [];
  return <section className="observation-report" aria-label="운영 관측 보고서">
    <h3 className="settings-subheading">요약</h3>
    <dl className="observation-facts">
      <div><dt>관측 응답</dt><dd>{formatCount(report.observedResponses)}줄</dd></div>
      <div><dt>어림 요청 수</dt><dd>약 {formatCount(report.weightedRequestsEstimate)}건</dd></div>
    </dl>
    <p className="context-note">관측 응답은 받은 로그에서 실제로 센 줄 수예요. 어림 요청 수는 성공 표본에 가중치를 곱해 더한 어림값이라 정확한 요청 수가 아니에요.</p>
    <p className="context-note">입력 {formatCount(report.input.lines)}줄 중 빈 줄 {formatCount(report.input.blankLines)}줄과 수집 로그가 아닌 줄 {formatCount(report.input.ignoredOtherLogLines)}줄은 무시했어요. 같은 요청·실행이 다시 나온 중복 {formatCount(report.input.duplicateLogLines)}줄은 한 번만 셌어요.</p>

    <div className="table-section observation-diagnostics">
      <h3 className="settings-subheading">진단 항목</h3>
      {!diagnostics
        ? <p className="notice" role="status">이 보고서에는 진단 객체가 없어요. 진단이 붙기 전에 만든 v2 보고서라 오류·확인 필요 항목을 분류하지 못했어요. 위 요약과 아래 운영별 응답·보존 정리 집계는 그대로 볼 수 있어요.</p>
        : findings.length === 0
          ? <p className="notice" role="status">제공된 로그에서 분류된 진단 항목이 없어요. 관측 수가 0인 항목은 넣지 않아요.</p>
          : <>
            <p className="context-note">한 응답이 여러 항목에 겹쳐 들어가지 않아요. 관측 수는 로그에서 센 수이고 가중치나 실패율이 아니에요.</p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="진단 항목 표">
              <table className="event-table observation-table">
                <caption className="sr-only">관측 로그에서 분류한 오류·확인 필요 항목</caption>
                <thead><tr><th scope="col">구분</th><th scope="col">운영</th><th scope="col">코드</th><th scope="col">단위</th>
                  <th scope="col" className="number-cell">관측 수</th><th scope="col">확인할 것</th></tr></thead>
                <tbody>{findings.map(finding => <tr key={`${finding.operation}:${finding.code}`}>
                  <th scope="row" className={severityClass(finding.severity)}>{SEVERITY_LABELS[finding.severity]}</th>
                  <td>{OPERATION_LABELS[finding.operation]}</td>
                  <td><code>{finding.code}</code></td>
                  <td>{UNIT_LABELS[finding.unit]}</td>
                  <td className="number-cell">{formatCount(finding.observedCount)}</td>
                  <td>{ACTION_LABELS[finding.action]}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
    </div>

    <div className="table-section observation-operations">
      <h3 className="settings-subheading">운영별 응답</h3>
      {report.operations.length === 0
        ? <p className="notice" role="status">받은 로그에 HTTP 응답이 없어요. 보존 정리 기록만 있는 보고서예요.</p>
        : <>
          <p className="context-note">로그에 남은 운영만 보여줘요. 응답 표는 운영마다 {RESPONSE_PAGE_SIZE}줄씩 보여주고, 지연 구간은 수집기가 남긴 거친 구간이라 시작·완료 시각을 못 재면 ‘측정 못함’으로 남아요.</p>
          {report.operations.map(operation => <ObservationOperation key={operation.operation} operation={operation}
            page={pages[operation.operation] ?? 0} onPage={page => changePage(operation.operation, page)} />)}
        </>}
    </div>

    <div className="table-section observation-cleanup">
      <h3 className="settings-subheading">보존 정리</h3>
      <dl className="observation-facts">
        <div><dt>보고 있는 실행</dt><dd>{formatCount(report.cleanup.observedRuns)}회</dd></div>
        <div><dt>상세 없는 실패</dt><dd>{formatCount(report.cleanup.reportlessFailureRuns)}회</dd></div>
        <div><dt>시도 처리 횟수</dt><dd>{report.cleanup.reportedRuns ? `${formatCount(report.cleanup.attemptedProjects)}회` : '—'}</dd></div>
        <div><dt>성공 처리 횟수</dt><dd>{report.cleanup.reportedRuns ? `${formatCount(report.cleanup.completedProjects)}회` : '—'}</dd></div>
        <div><dt>실패 처리 횟수</dt><dd>{report.cleanup.reportedRuns ? `${formatCount(report.cleanup.failedProjects)}회` : '—'}</dd></div>
      </dl>
      {report.cleanup.metrics && <dl className="metric-list">
        <div><dt>삭제한 행</dt><dd>{formatCount(report.cleanup.metrics.deletedRows)}</dd></div>
        <div><dt>삭제 한도에 도달한 테이블 처리 횟수</dt><dd>{formatCount(report.cleanup.metrics.saturatedTables)}</dd></div>
        <div><dt>관측한 만료 영수증 최장 지연</dt><dd>{report.cleanup.metrics.oldestExpiredReceiptAgeMs === null ? '남은 만료 영수증 없음' : `${Math.ceil(report.cleanup.metrics.oldestExpiredReceiptAgeMs / 60000)}분`}</dd></div>
        <div><dt>설정된 수신량 대비 정리 한도 부족</dt><dd>{formatCount(report.cleanup.metrics.capacityLimitedProjects)}회</dd></div>
      </dl>}
      {report.cleanup.execution && <>
        <dl className="metric-list">
          <div><dt>중단 이유를 기록한 실행</dt><dd>{formatCount(report.cleanup.execution.reportedRuns)}회 / {formatCount(report.cleanup.reportedRuns)}회</dd></div>
          <div><dt>관측한 최대 실행 시간</dt><dd>{formatCount(report.cleanup.execution.maxElapsedMs)}ms</dd></div>
          <div><dt>관측한 최대 예약 실행 지연</dt><dd>{report.cleanup.execution.maxScheduleLagMs === null ? '측정 기록 없음' : `${formatCount(report.cleanup.execution.maxScheduleLagMs)}ms`}</dd></div>
          <div><dt>결과를 확인하지 못한 작업</dt><dd>{formatCount(report.cleanup.execution.interruptedProjects)}회</dd></div>
          <div><dt>커서 진행을 확인한 시도</dt><dd>{formatCount(report.cleanup.execution.checkpointedProjects)}회</dd></div>
          {report.cleanup.execution.stopReasons.map(row => <div key={row.reason}><dt>{CLEANUP_REASONS[row.reason]}</dt><dd>{formatCount(row.runs)}회</dd></div>)}
        </dl>
        <p className="context-note">시간·페이지 한도는 다음 실행으로 넘긴 상태예요. 순회 종료가 만료 데이터 전체 삭제를 뜻하지 않으며, 커서는 실패한 작업도 지나갈 수 있어요. 예약 지연을 기록한 실행은 {formatCount(report.cleanup.execution.scheduleLagSamples)}회예요.</p>
      </>}
      {report.cleanup.metrics && <p className="context-note">성공적으로 측정한 프로젝트 {formatCount(report.cleanup.metrics.measuredProjects)}회 기준이에요. 전체 DB의 만료 잔량이나 실제 처리 속도를 뜻하지 않아요.</p>}
      {report.cleanup.reportedRuns === 0 && <p className="context-note">{report.cleanup.observedRuns === 0
        ? '정리 로그를 관측하지 못했어요. 처리 횟수는 알 수 없어요.'
        : '실패 표시만 있고 상세 보고가 없어요. 처리 횟수는 알 수 없어요.'}</p>}
      <p className="context-note">시도·성공·실패 처리 횟수는 상세 보고가 있는 실행의 합계예요. 고유 프로젝트 수나 삭제한 행 수가 아니고, 상세가 없는 실패 실행이 있으면 그 실행의 처리는 알 수 없어요.</p>
    </div>
  </section>;
}
