import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import { ApiError } from './api/client.ts';
import { loadCollectionDiagnostics, originMatch, type CollectionDiagnostics as Diagnostics } from './api/collection-diagnostics.ts';
import CollectionRejections from './CollectionRejections.tsx';
import type { EventSource } from './api/types.ts';
import { useI18n } from './i18n';
import { useLocaleFormat } from './i18n/format';
import { useMessageText } from './i18n/messages';

const DIAGNOSTICS_FAILED = '진단 결과를 읽지 못했어요. 다시 확인해 주세요.';

export default function CollectionDiagnostics({ client, projectId, version, refreshTick }: {
  client: ApiClient; projectId: string; version: number | null; refreshTick: number;
}) {
  const { t } = useI18n();
  const { count: formatCount, dateTime } = useLocaleFormat();
  const messageText = useMessageText();
  const [read, setRead] = useState<{ client: ApiClient; key: string; data: Diagnostics } | null>(null);
  const [reload, setReload] = useState(0), [origin, setOrigin] = useState('');
  const scope = JSON.stringify([projectId, version]);
  const [choice, setChoice] = useState<{ scope: string; source: EventSource } | null>(null);
  const requestedSource = choice?.scope === scope ? choice.source : undefined;
  const key = JSON.stringify([projectId, version, refreshTick, reload, requestedSource]);
  const data = read?.client === client && read.key === key ? read.data : null;
  useEffect(() => {
    const controller = new AbortController();
    void loadCollectionDiagnostics(client, projectId, version, controller.signal, new Date(), requestedSource)
      .then(data => { if (!controller.signal.aborted) setRead({ client, key, data }); })
      .catch(() => { if (!controller.signal.aborted) {
        const error = new ApiError('contract', DIAGNOSTICS_FAILED);
        setRead({ client, key, data: { settings: { error }, schema: { error }, receipt: null, rejections: { error } } });
      } });
    return () => controller.abort();
  }, [client, projectId, version, key]);
  const settings = data?.settings.value, schema = data?.schema.value, summary = data?.receipt?.value;
  const source = requestedSource ?? summary?.meta.source ?? (schema && !schema.events.some(event => event.source === 'browser') ? 'server' : 'browser');
  const receipt = summary?.meta.latestReceivedAt;
  const match = settings ? originMatch(origin, settings.allowedOrigins) : 'empty';
  const timeZone = summary?.meta.timeZone ?? 'UTC';
  const time = (value: string) => dateTime(value, timeZone);
  const errorText = (message: string) => message === DIAGNOSTICS_FAILED ? t('operations:diagLoadFailed') : messageText(message);
  return <section className="settings-section collection-diagnostics" aria-labelledby="collection-diagnostics-heading" aria-busy={!data || undefined}>
    <div className="settings-head"><h2 id="collection-diagnostics-heading">{t('operations:diagHeading')}</h2>
      <button className="secondary-button" type="button" disabled={!data} onClick={() => setReload(value => value + 1)}>{t('operations:diagRecheck')}</button></div>
    <p className="context-note">{t('operations:diagIntro')}</p>
      <label className="api-field"><span>{t('operations:diagSourceLabel')}</span>
        <select className="text-input settings-select" aria-label={t('operations:diagSourceLabel')} value={source} disabled={!schema} onChange={event => setChoice({ scope,
          source: event.target.value === 'server' ? 'server' : 'browser' })}>
          <option value="browser">{t('operations:diagBrowser')}</option><option value="server">{t('operations:diagServer')}</option></select></label>
    {!data ? <p role="status">{t('operations:diagLoading')}</p> : <>
      <dl className="diagnostic-facts">
        <div><dt>{t('operations:diagProjectSettings')}</dt><dd>{settings ? settings.project.status === 'active' ? t('operations:diagCollecting') : t('operations:diagPausedState') : t('operations:diagUnknown')}</dd></div>
        <div><dt>{t('operations:diagSelectedSchema')}</dt><dd>{schema ? t('operations:diagSchemaValue', { version: schema.schemaVersion, state: t(schema.schemaStatus === 'active' ? 'operations:diagSchemaActive' : 'operations:diagSchemaRetired') }) : t('operations:diagUnknown')}</dd></div>
        <div><dt>{t('operations:diagLastReceipt')}</dt><dd>{summary ? receipt ? <time dateTime={receipt}>{time(receipt)} · {timeZone}</time> : t('operations:diagNoReceipt') : t('operations:diagUnknown')}</dd></div>
        <div><dt>{t('operations:diagTodayEvents', { source: t(source === 'server' ? 'operations:diagServer' : 'operations:diagBrowser') })}</dt><dd>{summary ? t('operations:diagTodayValue', { count: formatCount(summary.totalEvents), from: summary.meta.from, timeZone }) : t('operations:diagUnknown')}</dd></div>
        <div><dt>{t('operations:diagRequestsPerMinute')}</dt><dd>{settings ? t('operations:diagRequestsValue', { count: formatCount(settings.limits.requestsPerMinute) }) : t('operations:diagUnknown')}</dd></div>
        <div><dt>{t('operations:diagDailyLimit')}</dt><dd>{settings ? t('operations:diagDailyValue', { count: formatCount(settings.limits.newReceiptsPerUtcDay) }) : t('operations:diagUnknown')}</dd></div>
      </dl>
      {summary && <p className="field-help">{t('operations:diagGeneratedAtLabel')}<time dateTime={summary.meta.generatedAt}>{time(summary.meta.generatedAt)}</time>{t('operations:diagGeneratedAtNote', { timeZone })}</p>}
      {data.settings.error && <p className="form-error" role="alert">{t('operations:diagSettingsError', { message: errorText(data.settings.error.message) })}</p>}
      {data.schema.error && <p className="form-error" role="alert">{t('operations:diagSchemaError', { message: errorText(data.schema.error.message) })}</p>}
      {data.receipt?.error && <p className="form-error" role="alert">{t('operations:diagReceiptError', { message: errorText(data.receipt.error.message) })}</p>}
      <CollectionRejections read={data.rejections} />
      {settings?.project.status === 'paused' && <p className="notice">{t('operations:diagPausedNotice', { action: t(settings.canEdit ? 'operations:diagPausedActionEditor' : 'operations:diagPausedActionViewer') })}</p>}
      {schema?.schemaStatus === 'retired' && <p className="notice">{t('operations:diagRetiredNotice')}</p>}
      {source === 'server' && <p className="notice">{t('operations:diagServerNotice')}</p>}
      {settings && source === 'browser' && <>
        {!settings.allowedOrigins.length && <p className="notice">{t('operations:diagNoOriginsNotice')}</p>}
        <h3 className="settings-subheading">{t('operations:diagOriginHeading')}</h3>
        <label className="field-label" htmlFor="diagnostic-origin">{t('operations:diagOriginLabel')}</label>
        <input id="diagnostic-origin" className="text-input" type="url" autoComplete="off" placeholder="https://app.example.com" value={origin}
          onChange={event => setOrigin(event.target.value)} aria-describedby="diagnostic-origin-help diagnostic-origin-result" />
        <p id="diagnostic-origin-help" className="field-help">{t('operations:diagOriginHelp')}</p>
        <p id="diagnostic-origin-result" role="status">{match === 'allowed' ? t('operations:diagOriginAllowed') : match === 'denied' ? t('operations:diagOriginDenied', { action: t(settings.canEdit ? 'operations:diagOriginDeniedEditor' : 'operations:diagOriginDeniedViewer') }) : match === 'invalid' ? t('operations:diagOriginInvalid') : t('operations:diagOriginEmpty')}</p>
        <details><summary>{t('operations:diagOriginsCount', { count: settings.allowedOrigins.length })}</summary><ul className="diagnostic-origins">{settings.allowedOrigins.map(value => <li key={value}><code>{value}</code></li>)}</ul></details>
      </>}
      <details className="diagnostic-troubleshooting"><summary>{t('operations:diagTroubleshooting')}</summary>
        <p className="context-note">{t('operations:diagTroubleshootingNote')}</p>
        <ol><li>{t(source === 'server' ? 'operations:diagCheck1Server' : 'operations:diagCheck1Browser')}</li>
          <li>{t('operations:diagCheck2')}</li>
          <li>{t(source === 'server' ? 'operations:diagCheck3Server' : 'operations:diagCheck3Browser')} {t('operations:diagCheck3Limit')}</li>
          <li>{t('operations:diagCheck4')}</li></ol>
      </details>
    </>}
  </section>;
}
