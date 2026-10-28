import { ArrowDown } from '@phosphor-icons/react';
import type { FunnelResponse } from './api/funnel-contract';
import type { Registry } from './api/types';
import { formatCount, formatRate } from './data';
import { sourceLabel } from './SourceEventTable';

export default function FunnelJourney({ data, registry }: { data: FunnelResponse; registry: Registry }) {
  const labels = new Map(registry.events.map(event => [`${event.source}:${event.name}`, event.label]));
  return <section aria-label="퍼널 단계별 여정"><div className="section-header"><h3>단계별 여정</h3><span className="context-note">첫 단계 대비 도달률</span></div>
    <ol className="goal-journey">{data.summary.steps.map(step => {
      const definition = data.definition.steps[step.stepIndex];
      return <li className="goal-journey-step" key={step.stepIndex}>
        <div className="goal-step-heading"><span className="funnel-step">{step.stepIndex + 1}단계</span><div>
          <strong>{labels.get(`${definition.source}:${definition.eventName}`) ?? definition.eventName}</strong>
          <p className="context-note"><code>{definition.eventName}</code> · {sourceLabel(definition.source)}</p>
        </div><strong>{formatCount(step.reachedRuns)}<small> 실행</small></strong></div>
        {step.reachRate !== null ? <progress className="goal-stage-meter" max={100} value={step.reachRate} aria-label={`${step.stepIndex + 1}단계 첫 단계 대비 도달률`} /> : <p className="context-note">도달률 — · 시작 실행이 없어요</p>}
        <div className="goal-stage-facts"><span>도달률 {formatRate(step.reachRate)}</span><span>직전 단계 대비 {formatRate(step.conversionRate)}</span></div>
        {step.notReachedNext !== null && <p className="goal-dropoff"><ArrowDown size={15} aria-hidden="true" />다음 단계 미도달 <strong>{formatCount(step.notReachedNext)} 실행</strong></p>}
      </li>;
    })}</ol>
  </section>;
}
