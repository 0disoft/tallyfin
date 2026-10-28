import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from './api/client';
import { HEALTH_IDLE, HealthReader, type HealthState } from './api/admin-health';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

/** The shown time is this manual check, not the metrics refresh time. */
function checkedAtText(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

/** Manual administrator storage read check: opening the panel sends nothing and nothing polls. */
export default function LiveHealth({ client }: { client: ApiClient }) {
  const { t, locale } = useI18n();
  const messageText = useMessageText();
  const readerRef = useRef<HealthReader | null>(null);
  const [read, setRead] = useState<{ client: ApiClient; state: HealthState } | null>(null);
  useEffect(() => {
    const reader = new HealthReader(client, state => setRead({ client, state }));
    readerRef.current = reader; setRead({ client, state: reader.state });
    return () => { reader.destroy(); if (readerRef.current === reader) readerRef.current = null; };
  }, [client]);
  const state = read?.client === client ? read.state : HEALTH_IDLE;
  return <details className="manual-connection" onToggle={event => { if (!event.currentTarget.open) readerRef.current?.close(); }}>
    <summary>{t('operations:healthSummary')}</summary>
    <section className="settings-section" aria-label={t('operations:healthSectionLabel')} aria-busy={state.phase === 'loading'}>
      <p className="context-note">{t('operations:healthIntro')}</p>
      {state.phase === 'loading' && <p className="context-note" role="status">{t('operations:healthLoading')}</p>}
      {state.phase === 'ready' && <p className="context-note" role="status">{state.checkedAt
        ? t('operations:healthReadyAt', { time: checkedAtText(state.checkedAt, locale) })
        : t('operations:healthReady')}</p>}
      {state.phase === 'error' && <p className="form-error" role="alert">{messageText(state.message)}</p>}
      <button className="secondary-button" type="button" disabled={state.phase === 'loading'} onClick={() => void readerRef.current?.open()}>
        {state.phase === 'loading' ? t('operations:healthChecking') : state.phase === 'idle' ? t('operations:healthCheck') : t('operations:healthRecheck')}
      </button>
    </section>
  </details>;
}
