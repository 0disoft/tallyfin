import { toApiError } from './api/load-state';
import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import type { Registry } from './api/types';
import { validateWorkflowLoad, type DateRange, type WorkflowFailure, type WorkflowLoad } from './api/period-comparison';

export default function WorkflowFailurePanel({ client, registry, range, failure, onRecovered }: {
  client: ApiClient; registry: Registry; range: DateRange; failure: WorkflowFailure; onRecovered: (load: WorkflowLoad) => void;
}) {
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
    <h2>{failure.definition.label}</h2><p>이 작업 흐름을 불러오지 못했어요. 다른 작업 흐름은 계속 확인할 수 있어요.</p>
    {error.kind === 'timeout' && <p>응답을 기다리는 시간이 지났어요.</p>}
    <button className="secondary-button" disabled={loading} onClick={() => void retry()}>{loading ? '다시 조회하는 중이에요' : `${failure.definition.label} 다시 시도`}</button>
  </section>;
}
