import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from './api/client';
import type { EventSource, Project } from './api/types';
import { countChange } from './api/period-comparison';
import { projectOverview, OVERVIEW_PAGE_SIZE, type ServiceRow } from './api/project-overview';
import { formatCount } from './data';
import OverviewWorkflowCell from './OverviewWorkflowCell';
import { overviewDateChanged, watchOverviewClock } from './api/overview-freshness';
import { shiftDate } from './api/dates';

export default function ProjectOverview({ client, projects, source, onSelectProject, hasMore, onLoadMore, loadingMore }: {
  client: ApiClient; projects: Project[]; source: EventSource; onSelectProject: (id: string) => void;
  hasMore: boolean; onLoadMore: () => void; loadingMore: boolean;
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const index = Math.min(page, Math.max(0, Math.ceil(projects.length / OVERVIEW_PAGE_SIZE) - 1));
  const visible = useMemo(() => projects.slice(index * OVERVIEW_PAGE_SIZE, (index + 1) * OVERVIEW_PAGE_SIZE), [projects, index]);
  const key = JSON.stringify([visible, source, refresh]);
  const [result, setResult] = useState<{ client: ApiClient; key: string; rows: ServiceRow[]; error?: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setResult(null);
    projectOverview(client, visible, source, controller.signal).then(rows => {
      if (!controller.signal.aborted) setResult({ client, key, rows });
    }).catch(() => { if (!controller.signal.aborted) setResult({ client, key, rows: [], error: true }); });
    return () => controller.abort();
  }, [client, visible, source, open, key]);
  const rows = result?.client === client && result.key === key ? result.rows : null;
  const [checkedAt, setCheckedAt] = useState(() => new Date());
  useEffect(() => {
    if (!open || !rows?.length) return;
    return watchOverviewClock(setCheckedAt);
  }, [open, rows]);
  const dateChanged = rows ? overviewDateChanged(rows, checkedAt) : false;
  return <section className="table-section" aria-labelledby="project-overview-heading">
    <div className="settings-head"><h2 id="project-overview-heading">서비스 통합 현황</h2>
      <button className="secondary-button" onClick={() => setOpen(value => !value)}>{open ? '통합 현황 닫기' : '통합 현황 불러오기'}</button></div>
    {open && <>
      <p className="context-note">{source === 'browser' ? '브라우저' : '서버'} 이벤트 · 서비스별 시간대의 최근 7일과 직전 7일이에요. 오늘은 집계 중이며, 완료율은 각 스키마 버전에 지정한 대표 작업 흐름을 표시해요. 거부 요청은 프로젝트 전체의 최근 UTC 7일 수집 거부 기록이에요. 최근 수신과 거부 기록은 활성 스키마가 없어도 조회해요.</p>
      {!!rows?.length && <p className="context-note">조회 기준(UTC): {new Date(rows[0]!.generatedAt).toLocaleString('ko-KR', { timeZone: 'UTC' })}</p>}
      {!!rows?.length && <p className="context-note">거부 기록(UTC): {shiftDate(rows[0]!.generatedAt.slice(0, 10), -6)} ~ {rows[0]!.generatedAt.slice(0, 10)}</p>}
      {dateChanged && <p role="status">조회 기준과 현재 기기 날짜가 달라졌어요. 표시된 기간을 확인하고 통합 현황을 새로고침해 주세요.</p>}
      <div className="toolbar"><button className="secondary-button" disabled={index === 0} onClick={() => setPage(index - 1)}>이전 서비스</button>
        <span>{index + 1} / {Math.max(1, Math.ceil(projects.length / OVERVIEW_PAGE_SIZE))} 페이지</span>
        <button className="secondary-button" disabled={(index + 1) * OVERVIEW_PAGE_SIZE >= projects.length} onClick={() => setPage(index + 1)}>다음 서비스</button>
        <button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>통합 현황 새로고침</button>
        {hasMore && <button className="secondary-button" disabled={loadingMore} onClick={onLoadMore}>프로젝트 더 불러오기</button>}</div>
      {!rows && <p role="status">현재 페이지의 서비스 현황을 확인하고 있어요.</p>}
      {result?.client === client && result.key === key && result.error && <p role="alert">서비스 현황을 불러오지 못했어요. 다시 조회해 주세요.</p>}
      {rows && !result?.error && <div className="table-scroll" tabIndex={0} aria-label="서비스별 수집과 완료 현황"><table className="event-table"><thead><tr>
        <th>서비스</th><th>최근 수신(프로젝트 전체)</th><th>이벤트 / 직전 기간 변화</th><th>작업 완료율 / 변화</th><th>거부 요청</th>
      </tr></thead><tbody>{rows.map(row => {
        const change = row.events === null || row.previousEvents === null ? null : countChange(row.events, row.previousEvents);
        return <tr key={row.project.id}><th scope="row"><button className="text-button" onClick={() => onSelectProject(row.project.id)}>{row.project.name}</button>
          <div>{row.project.status === 'paused' ? '일시정지' : '운영 중'} · {row.project.timeZone} · {row.error ? '조회 실패' : row.version === null ? '활성 스키마 없음' : `v${row.version}`}</div>
          {!row.error && (row.period ? <><div>현재 {row.period.from} ~ {row.period.to}</div>
            <div>직전 {row.period.previousFrom} ~ {row.period.previousTo}</div></> : <div>조회 기간 정보 없음</div>)}</th>
          {row.error ? <td colSpan={4}>조회하지 못했어요. 권한과 연결을 확인한 뒤 다시 조회해 주세요.</td> : <>
            <td>{row.latestReceivedAt ? new Date(row.latestReceivedAt).toLocaleString('ko-KR', { timeZone: row.project.timeZone }) : '수신 기록 없음 또는 미조회'}</td>
            <td>{row.events === null ? '—' : formatCount(row.events)} / {change === null ? '비교 불가' : `${change.toFixed(1)}%`}</td>
            <td><OverviewWorkflowCell row={row} source={source} /></td>
            <td>{row.rejectionUnavailable ? '조회 실패' : row.rejected === null ? '—' : formatCount(row.rejected)}</td>
          </>}</tr>;
      })}</tbody></table></div>}
      <p className="context-note">한 번에 최대 5개 서비스만 읽으며 자동 반복 조회는 하지 않아요. 완료율 변화는 두 기간이 집계 중이 아니고 각각 시작 30건 이상일 때 표시해요. 이는 통계적 유의성이나 장애 판정 기준은 아니에요. 수집기 앞단에서 차단한 요청은 거부 건수에 포함되지 않아요. 수신 기록이 없다는 이유만으로 장애로 판단하지 않아요.</p>
    </>}
  </section>;
}
