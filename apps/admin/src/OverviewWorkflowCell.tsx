import type { EventSource } from './api/types';
import type { ServiceRow } from './api/project-overview';
import { workflowComparison } from './api/overview-workflow';
import type { WorkflowSample } from './api/overview-workflow';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';

function Sample({ label, sample }: { label: string; sample: WorkflowSample }) {
  const { t } = useI18n();
  const { count: formatCount } = useLocaleFormat();
  return <div>{t('operations:flowSampleBase', { label, succeeded: formatCount(sample.succeededAttempts), started: formatCount(sample.startedAttempts) })}
    {t('operations:flowSamplePending', { pending: formatCount(sample.pendingAttempts) })}{sample.failedAttempts !== null && t('operations:flowSampleFailed', { failed: formatCount(sample.failedAttempts) })}
    {sample.provisional && t('operations:flowSampleProvisional')}</div>;
}
export default function OverviewWorkflowCell({ row, source }: { row: ServiceRow; source: EventSource }) {
  const { t } = useI18n();
  const { rate } = useLocaleFormat();
  if (row.workflowUnavailable) return <>{t('operations:flowFailed')}</>;
  const comparison = workflowComparison(row.workflowStats, row.completion, row.previousCompletion);
  // workflowComparison returns its own display reasons; map them back to catalog keys at render.
  const reasonLabel = (reason: string) => {
    switch (reason) {
      case '표본 정보 없음': return t('operations:overviewReasonNoSample');
      case '비교할 시작 기록 없음': return t('operations:overviewReasonNoStarts');
      case '집계 중 · 비교 보류': return t('operations:overviewReasonProvisional');
      case '표본 적음 · 비교 보류': return t('operations:overviewReasonSmallSample');
      default: return reason;
    }
  };
  return <>{row.version === null ? t('operations:overviewNoSchema') : source === 'server' ? t('operations:flowServerUnsupported') : row.workflowLabel ?? t('admin:noRepresentativeWorkflow')}
    <div>{rate(row.completion)} / {comparison.delta === null ? t('operations:overviewIncomparable') : `${comparison.delta.toFixed(1)}%p`}</div>
    {row.workflowStats && <><Sample label={t('operations:flowCurrent')} sample={row.workflowStats.current} /><Sample label={t('operations:flowPrevious')} sample={row.workflowStats.previous} /></>}
    {row.workflowLabel && <div>{comparison.reason ? reasonLabel(comparison.reason) : ''}</div>}</>;
}
