import { formatCount, formatRate } from './data';
import type { EventSource } from './api/types';
import type { WorkflowLoad } from './api/period-comparison';
import { countChange } from './api/period-comparison';

export default function SourceMetrics({ source, totalEvents, primary, startLabel, successLabel, previousTotal }: {
  source: EventSource; totalEvents: number; primary: WorkflowLoad | null; startLabel: string; successLabel: string;
  previousTotal?: number;
}) {
  const change = countChange(totalEvents, previousTotal ?? null);
  const metrics = [
    [`수집된 ${source === 'browser' ? '브라우저' : '서버'} 이벤트`, formatCount(totalEvents)],
    [`${primary?.definition.label ?? startLabel} · 시작 시도`, primary ? formatCount(primary.response.summary.startedAttempts) : '—'],
    [`${primary?.definition.label ?? successLabel} · 성공 시도`, primary ? formatCount(primary.response.summary.succeededAttempts) : '—'],
    ['완료율', primary ? formatRate(primary.response.summary.completionRate) : '—'],
  ];
  return <section className="metric-grid" aria-label="주요 지표">
    {metrics.filter((_, index) => source === 'browser' || index === 0).map(([label, value], index) => <div className="metric" key={label}>
      <div className="metric-label">{label}</div><div className="metric-value">{value}</div>
      {index === 0 && previousTotal !== undefined && <div className="metric-detail">{change === null ? '이전 0건 · 증감률 계산 불가' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`} · 이전 {formatCount(previousTotal)}건</div>}
      {index === 3 && primary && <div className="metric-detail">{formatCount(primary.response.summary.succeededAttempts)} / {formatCount(primary.response.summary.startedAttempts)}</div>}
    </div>)}
  </section>;
}
