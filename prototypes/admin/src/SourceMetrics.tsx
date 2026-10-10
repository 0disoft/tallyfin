import { formatCount, formatRate } from './data';
import type { EventSource } from './api/types';
import type { WorkflowLoad } from './api/period-comparison';

export default function SourceMetrics({ source, totalEvents, primary, startLabel, successLabel }: {
  source: EventSource; totalEvents: number; primary: WorkflowLoad | null; startLabel: string; successLabel: string;
}) {
  const metrics = [
    ['수집 이벤트', formatCount(totalEvents)],
    [startLabel, primary ? formatCount(primary.response.summary.startedAttempts) : '—'],
    [successLabel, primary ? formatCount(primary.response.summary.succeededAttempts) : '—'],
    ['완료율', primary ? formatRate(primary.response.summary.completionRate) : '—'],
  ];
  return <section className="metric-grid" aria-label="주요 지표">
    {metrics.filter((_, index) => source === 'browser' || index === 0).map(([label, value], index) => <div className="metric" key={label}>
      <div className="metric-label">{label}</div><div className="metric-value">{value}</div>
      {index === 3 && primary && <div className="metric-detail">{formatCount(primary.response.summary.succeededAttempts)} / {formatCount(primary.response.summary.startedAttempts)}</div>}
    </div>)}
  </section>;
}
