import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import { HEALTH_IDLE, HealthReader, type HealthState } from './api/admin-health';

/** The shown time is this manual check, not the metrics refresh time. */
function checkedAtText(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

/** Manual administrator storage read check: opening the panel sends nothing and nothing polls. */
export default function LiveHealth({ client }: { client: ApiClient }) {
  const readerRef = useRef<HealthReader | null>(null);
  const [read, setRead] = useState<{ client: ApiClient; state: HealthState } | null>(null);
  useEffect(() => {
    const reader = new HealthReader(client, state => setRead({ client, state }));
    readerRef.current = reader; setRead({ client, state: reader.state });
    return () => { reader.destroy(); if (readerRef.current === reader) readerRef.current = null; };
  }, [client]);
  const state = read?.client === client ? read.state : HEALTH_IDLE;
  const label = state.phase === 'idle' ? '읽기 확인' : '다시 확인';
  return <details className="manual-connection" onToggle={event => { if (!event.currentTarget.open) readerRef.current?.close(); }}>
    <summary>저장소 읽기 확인</summary>
    <section className="settings-section" aria-label="관리자 저장소 읽기 확인" aria-busy={state.phase === 'loading'}>
      <p className="context-note">관리자 저장소를 읽을 수 있는지 확인해요. 수집 저장과 정리 작업은 별도로 확인해야 해요.</p>
      {state.phase === 'loading' && <p className="context-note" role="status">저장소 읽기를 확인하는 중이에요.</p>}
      {state.phase === 'ready' && <p className="context-note" role="status">저장소 읽기를 확인했어요.{state.checkedAt ? ` 확인 시각 ${checkedAtText(state.checkedAt)}` : ''}</p>}
      {state.phase === 'error' && <p className="form-error" role="alert">{state.message}</p>}
      <button className="secondary-button" type="button" disabled={state.phase === 'loading'} onClick={() => void readerRef.current?.open()}>
        {state.phase === 'loading' ? '확인 중' : label}
      </button>
    </section>
  </details>;
}
