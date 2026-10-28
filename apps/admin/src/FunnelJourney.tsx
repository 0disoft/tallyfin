import { ArrowDown } from '@phosphor-icons/react';
import type { FunnelResponse } from './api/funnel-contract';
import type { Registry } from './api/types';
import { sourceLabel } from './SourceEventTable';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

export default function FunnelJourney({ data, registry }: { data: FunnelResponse; registry: Registry }) {
  const { t } = useI18n();
  const { count: formatCount, rate: formatRate } = useLocaleFormat();
  const labels = new Map(registry.events.map(event => [`${event.source}:${event.name}`, event.label]));
  const sourceLabels = { server: t('analysis:sourceServer'), browser: t('analysis:sourceBrowser') };
  return <section aria-label={t('analysis:funnelJourney')}><div className="section-header"><h3>{t('analysis:stageJourney')}</h3><span className="context-note">{t('analysis:reachFromFirst')}</span></div>
    <ol className="goal-journey">{data.summary.steps.map(step => {
      const definition = data.definition.steps[step.stepIndex];
      return <li className="goal-journey-step" key={step.stepIndex}>
        <div className="goal-step-heading"><span className="funnel-step">{t('analysis:funnelStepLabel', { stage: step.stepIndex + 1 })}</span><div>
          <strong>{labels.get(`${definition.source}:${definition.eventName}`) ?? definition.eventName}</strong>
          <p className="context-note"><code>{definition.eventName}</code> · {sourceLabel(definition.source, sourceLabels)}</p>
        </div><strong>{formatCount(step.reachedRuns)}<small> {t('analysis:runUnit')}</small></strong></div>
        {step.reachRate !== null ? <progress className="goal-stage-meter" max={100} value={step.reachRate} aria-label={t('analysis:stageReachAria', { stage: step.stepIndex + 1 })} /> : <p className="context-note">{t('analysis:reachUnavailableNoStarts')}</p>}
        <div className="goal-stage-facts"><span>{t('analysis:reachRate', { rate: formatRate(step.reachRate) })}</span><span>{t('analysis:conversionFromPreviousRate', { rate: formatRate(step.conversionRate) })}</span></div>
        {step.notReachedNext !== null && <p className="goal-dropoff"><ArrowDown size={15} aria-hidden="true" />{t('analysis:notReachedNextLabel')} <strong>{t('analysis:runCount', { count: formatCount(step.notReachedNext) })}</strong></p>}
      </li>;
    })}</ol>
  </section>;
}
