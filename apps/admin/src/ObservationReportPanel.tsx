import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { REPORT_IDLE, ReportReader, type ReportState } from './api/observation-reader.ts';
import ObservationReportView from './ObservationReportView';

/** Reports belong to the selected local file, never the project/date filters or an API request. */
export default function ObservationReportPanel({ client }: { client: ApiClient }) {
  const readerRef = useRef<ReportReader | null>(null);
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; state: ReportState } | null>(null);
  useEffect(() => {
    const reader = new ReportReader(state => setSnapshot({ client, state }));
    readerRef.current = reader; setSnapshot({ client, state: reader.state });
    return () => { reader.destroy(); if (readerRef.current === reader) readerRef.current = null; };
  }, [client]);
  const state = snapshot?.client === client ? snapshot.state : REPORT_IDLE;
  return <details className="manual-connection" onToggle={event => { if (!event.currentTarget.open) readerRef.current?.close(); }}>
    <summary>운영 로그 보고서</summary>
    <section className="settings-section" aria-label="로컬 운영 로그 보고서" aria-busy={state.phase === 'loading'}>
      <p className="context-note">logs:summary가 만든 JSON 보고서를 선택하세요. 파일은 브라우저에서만 읽으며 서버로 보내거나 저장하지 않아요.</p>
      <p className="context-note">수집기 전체의 로그 요약이에요. 위 프로젝트·조회 기간과 별개이며, 보고서의 시간 범위는 알 수 없어요.</p>
      <label className="field-label" htmlFor="observation-report-file">JSON 보고서 (8MiB 이하)</label>
      <input className="text-input" id="observation-report-file" type="file" accept=".json,application/json" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) readerRef.current?.read(file);
      }} />
      {state.phase === 'loading' && <p className="context-note" role="status">보고서를 읽고 있어요.</p>}
      {state.phase === 'error' && <p className="form-error" role="alert">{state.message}</p>}
      {state.report && <><p className="context-note" role="status">보고서를 읽었어요. 성공 응답은 1/64 표본으로 관측해요.</p>
        <ObservationReportView report={state.report} /></>}
      {state.phase !== 'idle' && <button className="secondary-button" type="button" onClick={() => readerRef.current?.close()}>보고서 지우기</button>}
    </section>
  </details>;
}
