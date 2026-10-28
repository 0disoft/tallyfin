import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { REPORT_IDLE, ReportReader, type ReportState } from './api/observation-reader.ts';
import ObservationReportView from './ObservationReportView';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

/** Reports belong to the selected local file, never the project/date filters or an API request. */
export default function ObservationReportPanel({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const readerRef = useRef<ReportReader | null>(null);
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; state: ReportState } | null>(null);
  useEffect(() => {
    const reader = new ReportReader(state => setSnapshot({ client, state }));
    readerRef.current = reader; setSnapshot({ client, state: reader.state });
    return () => { reader.destroy(); if (readerRef.current === reader) readerRef.current = null; };
  }, [client]);
  const state = snapshot?.client === client ? snapshot.state : REPORT_IDLE;
  return <details className="manual-connection" onToggle={event => { if (!event.currentTarget.open) readerRef.current?.close(); }}>
    <summary>{t('operations:reportSummary')}</summary>
    <section className="settings-section" aria-label={t('operations:reportSectionLabel')} aria-busy={state.phase === 'loading'}>
      <p className="context-note">{t('operations:reportIntro1')}</p>
      <p className="context-note">{t('operations:reportIntro2')}</p>
      <label className="field-label" htmlFor="observation-report-file">{t('operations:reportFileLabel')}</label>
      <input className="text-input" id="observation-report-file" type="file" accept=".json,application/json" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) readerRef.current?.read(file);
      }} />
      {state.phase === 'loading' && <p className="context-note" role="status">{t('operations:reportLoading')}</p>}
      {state.phase === 'error' && <p className="form-error" role="alert">{messageText(state.message)}</p>}
      {state.report && <><p className="context-note" role="status">{t('operations:reportLoaded')}</p>
        <ObservationReportView report={state.report} /></>}
      {state.phase !== 'idle' && <button className="secondary-button" type="button" onClick={() => readerRef.current?.close()}>{t('operations:reportClear')}</button>}
    </section>
  </details>;
}
