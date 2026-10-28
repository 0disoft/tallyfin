import { useEffect, useState } from 'react';
import type { ApiClient } from './api/client.ts';
import type { EventSource, FunnelDefinition, Registry } from './api/types.ts';
import type { SdkProfile } from './api/sdk-setup.ts';
import { latestSchema } from './api/latest-schema.ts';
import { sdkFunnels, sdkSetup } from './api/sdk-setup.ts';
import { useI18n } from './i18n';
import { useMessageText } from './i18n/messages';

/** Funnels with at least one step in this source. Unreadable definitions never offer an example. */
function sourceFunnels(registry: Registry | null, source: EventSource): FunnelDefinition[] {
  if (!registry) return [];
  try { return sdkFunnels(registry, source); } catch { return []; }
}

export default function LiveSdkSetup({ client, projectId, refreshTick }: { client: ApiClient; projectId: string; refreshTick: number }) {
  const { t } = useI18n();
  const messageText = useMessageText();
  const [origin, setOrigin] = useState(''), [reload, setReload] = useState(0);
  const [copyStatus, setCopyStatus] = useState<{ client: ApiClient; key: string; snippet: string; kind: 'copied' | 'copyFailed' } | null>(null);
  const key = JSON.stringify([projectId, refreshTick, reload]);
  const [read, setRead] = useState<{ client: ApiClient; key: string; registry: Registry | null; status: 'loading' | 'ready' | 'empty' | 'error' } | null>(null);
  const current = read?.client === client && read.key === key ? read : null;
  const registry = current?.registry ?? null, status = current?.status ?? 'loading';
  const [choice, setChoice] = useState<{ key: string; source: EventSource } | null>(null);
  const [kind, setKind] = useState<{ key: string; profile: SdkProfile } | null>(null);
  const [example, setExample] = useState<{ key: string; funnelId: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setRead({ client, key, status: 'loading', registry: null }); setCopyStatus(null);
    void (async () => {
      try {
        const selected = await latestSchema(client, projectId, controller.signal);
        if (controller.signal.aborted) return;
        if (selected.active === null) { setRead({ client, key, status: 'empty', registry: null }); return; }
        const definition = await client.getSchema(projectId, selected.active, { signal: controller.signal });
        if (!controller.signal.aborted) setRead({ client, key, registry: definition, status: 'ready' });
      } catch { if (!controller.signal.aborted) setRead({ client, key, status: 'error', registry: null }); }
    })();
    return () => controller.abort();
  }, [client, projectId, refreshTick, reload]);
  const scope = registry ? JSON.stringify([projectId, registry.schemaVersion]) : '';
  const source: EventSource = choice?.key === scope && registry?.events.some(event => event.source === choice.source)
    ? choice.source : registry?.events.some(event => event.source === 'browser') ? 'browser' : 'server';
  // 선택은 현재 프로젝트·스키마·출처에 묶고, 등록에서 사라진 값은 기본값으로 되돌린다.
  const choiceScope = JSON.stringify([scope, source]);
  const funnels = sourceFunnels(registry, source), browserFunnels = sourceFunnels(registry, 'browser');
  const profile: SdkProfile = kind?.key === choiceScope && kind.profile === 'funnels' && browserFunnels.length ? 'funnels' : 'standard';
  const funnelId = example?.key === choiceScope && funnels.some(funnel => funnel.id === example.funnelId) ? example.funnelId : funnels[0]?.id ?? '';
  const showKind = source === 'browser' && browserFunnels.length > 0;
  const showExample = funnels.length > 0 && (source === 'server' || profile === 'funnels');
  const options: { profile?: SdkProfile; funnelId?: string } = source === 'browser' ? { profile } : {};
  if (showExample && funnelId) options.funnelId = funnelId;
  let snippet = '', error = '', localError = false;
  if (registry && origin) try { snippet = sdkSetup(registry, origin, source, options); } catch (e) {
    if (e instanceof Error) error = e.message; else localError = true;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopyStatus({ client, key, snippet, kind: 'copied' }); }
    catch { setCopyStatus({ client, key, snippet, kind: 'copyFailed' }); }
  }
  return <section className="settings-section sdk-setup" id="sdk-setup" aria-labelledby="sdk-setup-heading" aria-busy={status === 'loading' || undefined}>
    <div className="settings-head"><h2 id="sdk-setup-heading">{t('settings:sdkTitle')}</h2><button className="secondary-button" onClick={() => setReload(r => r + 1)}>{t('settings:recheckSchema')}</button></div>
    {status === 'loading' && <p role="status">{t('settings:sdkCheckingSchema')}</p>}
    {status === 'error' && <p className="form-error" role="alert">{t('settings:sdkSchemaError')}</p>}
    {status === 'empty' && <p className="notice">{t('settings:sdkEmpty')} <a href="#schema-heading">{t('settings:registerSchemaLink')}</a></p>}
    {registry && <>
      <p className="context-note">{t('settings:sdkProjectMeta', { projectId, version: registry.schemaVersion })}</p>
      <label className="field-label" htmlFor="sdk-source">{t('settings:sdkSource')}</label>
      <select className="text-input settings-select" id="sdk-source" value={source} onChange={event => {
        setChoice({ key: scope, source: event.target.value === 'server' ? 'server' : 'browser' }); setCopyStatus(null);
      }}><option value="browser" disabled={!registry.events.some(event => event.source === 'browser')}>{t('settings:browser')}</option>
        <option value="server" disabled={!registry.events.some(event => event.source === 'server')}>{t('settings:server')}</option></select>
      <p className="field-help">{source === 'browser' ? t('settings:sdkBrowserOriginHelp') : t('settings:sdkServerAuthHelp')}</p>
      {showKind && <>
        <label className="field-label" htmlFor="sdk-browser-kind">{t('settings:browserSdkKind')}</label>
        <select className="text-input settings-select" id="sdk-browser-kind" value={profile} aria-describedby="sdk-browser-kind-help" onChange={event => {
          setKind({ key: choiceScope, profile: event.target.value === 'funnels' ? 'funnels' : 'standard' }); setCopyStatus(null);
        }}><option value="standard">{t('settings:sdkStandardProfile')}</option><option value="funnels">{t('settings:sdkFunnelProfile')}</option></select>
        <p className="field-help" id="sdk-browser-kind-help">{profile === 'funnels'
          ? t('settings:sdkFunnelProfileHelp')
          : t('settings:sdkStandardProfileHelp')}</p>
      </>}
      {showExample && <>
        <label className="field-label" htmlFor="sdk-funnel-example">{t('settings:funnelExample')}</label>
        <select className="text-input settings-select" id="sdk-funnel-example" value={funnelId} aria-describedby="sdk-funnel-example-help" onChange={event => {
          setExample({ key: choiceScope, funnelId: event.target.value }); setCopyStatus(null);
        }}>{funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.label}</option>)}</select>
        <p className="field-help" id="sdk-funnel-example-help">{source === 'server'
          ? t('settings:sdkServerFunnelHelp')
          : t('settings:sdkBrowserFunnelHelp')}</p>
      </>}
      <ol className="sdk-instructions"><li>{t('settings:sdkBuildStep', { source })}</li>
        <li>{t('settings:sdkLinkStep', { source })}{source === 'server' ? t('settings:sdkServerPackageNote') : profile === 'funnels' ? t('settings:sdkFunnelPackageNote') : t('settings:sdkBrowserPackageNote')}</li>
        <li>{source === 'server' ? t('settings:sdkServerTokenStep') : t('settings:sdkBrowserTokenStep')}</li></ol>
      <label className="field-label" htmlFor="sdk-origin">{t('settings:collectorOrigin')}</label>
      <input className="text-input" id="sdk-origin" value={origin} placeholder="https://analytics.example.com" type="url" autoComplete="off"
        aria-describedby="sdk-origin-help sdk-origin-error" aria-invalid={Boolean(error || localError) || undefined} onChange={e => { setOrigin(e.target.value); setCopyStatus(null); }} />
      <p className="field-help" id="sdk-origin-help">{t('settings:originHelp')}</p>
      <p className="form-error" id="sdk-origin-error" role={error || localError ? 'alert' : undefined}>{error ? messageText(error) : localError ? t('settings:sdkOriginError') : ''}</p>
      {snippet && <><textarea className="text-input schema-textarea sdk-code" readOnly rows={12} aria-label={t('settings:sdkCodeLabel', { source: source === 'server' ? t('settings:server') : t('settings:browser') })} value={snippet} spellCheck={false} />
        <div className="form-actions"><button className="secondary-button" onClick={() => { void copy(); }}>{t('settings:copyCode')}</button></div></>}
      <p role="status">{copyStatus?.client === client && copyStatus.key === key && copyStatus.snippet === snippet ? copyStatus.kind === 'copied' ? t('settings:codeCopied') : t('settings:copyFailed') : ''}</p>
    </>}
  </section>;
}
