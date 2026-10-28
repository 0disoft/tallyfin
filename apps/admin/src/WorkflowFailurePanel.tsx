import { toApiError } from './api/load-state';
import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import type { Registry } from './api/types';
import { validateWorkflowLoad, type DateRange, type WorkflowFailure, type WorkflowLoad } from './api/period-comparison';
import { useI18n } from './i18n';

export default function WorkflowFailurePanel({ client, registry, range, failure, onRecovered }: {
  client: ApiClient; registry: Registry; range: DateRange; failure: WorkflowFailure; onRecovered: (load: WorkflowLoad) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(failure.error);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function retry() {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setLoading(true);
    try {
      const load = { definition: failure.definition, response: await client.getWorkflowDaily(registry.project.id, failure.definition.id,
        { ...range, schemaVersion: registry.schemaVersion, signal: request.signal }) };
      validateWorkflowLoad(load, registry, range);
      if (!request.signal.aborted) onRecovered(load);
    } catch (cause) { if (!request.signal.aborted) setError(toApiError(cause)); }
    finally { if (!request.signal.aborted) { controller.current = null; setLoading(false); } }
  }
  return <section className="goal-section" role="alert" aria-busy={loading || undefined}>
    <h2>{failure.definition.label}</h2><p>{t('analysis:workflowLoadError')}</p>
    {error.kind === 'timeout' && <p>{t('analysis:requestTimedOut')}</p>}
    <button className="secondary-button" disabled={loading} onClick={() => void retry()}>{loading ? t('analysis:retryingWorkflow') : t('analysis:retryWorkflowNamed', { workflow: failure.definition.label })}</button>
  </section>;
}
