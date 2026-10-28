import { ArrowRight, Circle } from '@phosphor-icons/react';
import { Trend } from './Dashboard';
import SourceMetrics from './SourceMetrics';
import { formatCount, type View } from './data';
import { workflowRecords, type EventRow } from './api/dashboard-model';
import type { WorkflowLoad } from './api/period-comparison';
import type { EventSource } from './api/types';
import './event-shell.css';
import './overview-workspace.css';

type Props = {
  source: EventSource; totalEvents: number; rows: EventRow[]; primary: WorkflowLoad | null;
  startLabel: string; successLabel: string; previousTotal?: number;
  onNavigate?: (view: View) => void;
};

export default function OverviewWorkspace({ source, totalEvents, rows, primary, startLabel, successLabel, previousTotal, onNavigate }: Props) {
  const visible = rows.filter(row => row.source === source || row.source === null)
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  const maximum = visible.reduce((max, row) => Math.max(max, row.count ?? 0), 1);
  const outcome = primary?.response.summary;
  return <div className="overview-workspace">
    <SourceMetrics source={source} totalEvents={totalEvents} primary={primary} startLabel={startLabel} successLabel={successLabel} previousTotal={previousTotal} />
    {totalEvents === 0 && <p className="notice" role="status">선택한 기간에 수신된 {source === 'browser' ? '브라우저' : '서버'} 이벤트가 없어요.</p>}
    <div className="overview-columns">
      <section className="overview-trend" aria-labelledby="overview-trend-heading">
        {primary ? <>
          <div className="section-header"><h2 id="overview-trend-heading">{primary.definition.label} · 일별 시작 시도</h2></div>
          <div className="legend"><Circle size={10} weight="fill" color="#155EEF" />시작 시도</div>
          <div className="chart-panel"><Trend records={workflowRecords(primary)} event={primary.definition.startEvent} kind="bar" /></div>
        </> : <div className="state-panel" role="status">
          <h2 id="overview-trend-heading">{source === 'server' ? '서버 이벤트 분석' : '대표 흐름 미지정'}</h2>
          <p>{source === 'server' ? '서버 이벤트의 일별 추이와 속성별 건수는 이벤트 분석에서 확인할 수 있어요.' : '설정에서 대표 작업 흐름을 선택하고 새 버전을 발행하면 시작 시도와 완료율을 볼 수 있어요.'}</p>
          {source === 'browser' && onNavigate && <button className="secondary-button" type="button" onClick={() => onNavigate('settings')}>스키마 설정 보기</button>}
        </div>}
      </section>
      <section className="overview-events" aria-labelledby="overview-events-heading">
        <div className="section-header"><h2 id="overview-events-heading" aria-label="등록 이벤트 집계">주요 이벤트</h2>
          {onNavigate && <button className="text-button" type="button" onClick={() => onNavigate('events')}>이벤트 분석 보기<ArrowRight size={16} /></button>}</div>
        <div className="overview-event-list">{visible.map(row => <div className="overview-event-row" key={row.definition.name}>
          <span className="overview-event-label"><strong>{row.definition.label}</strong><small>{row.definition.name}{row.source === null && ' · 등록에 없음'}</small></span>
          <strong className="overview-event-count">{row.count === null ? '—' : formatCount(row.count)}</strong>
          {row.count !== null && <meter className="overview-event-bar" min={0} max={maximum} value={row.count} aria-label={`${row.definition.label} 건수`} />}
        </div>)}</div>
        {!visible.length && <p role="status">이 출처에 등록된 이벤트가 없어요.</p>}
      </section>
    </div>
    {primary && outcome && <section className="overview-outcomes" aria-labelledby="overview-outcomes-heading">
      <h2 id="overview-outcomes-heading">{primary.definition.label} 진행 현황</h2>
      <dl>{([['시작 시도', outcome.startedAttempts], ['성공', outcome.succeededAttempts], ['확정 실패', outcome.failedAttempts], ['진행 중', outcome.pendingAttempts]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count === null ? '미정의' : formatCount(count)}</dd></div>)}</dl>
      {onNavigate && <button className="text-button" type="button" onClick={() => onNavigate('goals')}>목표에서 자세히 보기<ArrowRight size={16} /></button>}
    </section>}
  </div>;
}
