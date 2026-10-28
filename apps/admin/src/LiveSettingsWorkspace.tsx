import { lazy, useRef, useState } from 'react';
import CollectionDiagnostics from './CollectionDiagnostics';
import DeferredPanel from './DeferredPanel';
import LiveHealth from './LiveHealth';
import LiveIdentity from './LiveIdentity';
import LiveSettings from './LiveSettings';
import LiveSchemas from './LiveSchemas';
import LiveSdkSetup from './LiveSdkSetup';
import type { ApiClient } from './api/client';
import type { ProjectSettings, Registry } from './api/types';
import type { DraftExitRegistration } from './api/draft-exit-guard';
import { useI18n } from './i18n';
import './settings-workspace.css';

const ObservationReportPanel = lazy(() => import('./ObservationReportPanel'));
const TABS = [
  { id: 'project', label: 'tabProject', panel: 'editor' },
  { id: 'diagnostics', label: 'tabDiagnostics', panel: 'diagnostics' },
  { id: 'schema', label: 'tabSchema', panel: 'schema' },
  { id: 'sdk', label: 'tabSdk', panel: 'sdk' },
  { id: 'access', label: 'tabAccess', panel: 'editor' },
] as const;
type Tab = typeof TABS[number]['id'];

type Props = {
  client: ApiClient; projectId: string; version: number | null; registry: Registry | null;
  newlyCreated: boolean; refreshTick: number; setupRefreshTick: number; diagnosticsRevision: number;
  onSaved: (settings: ProjectSettings) => void; onAccessLost: () => void; onVersionChange: (version: number) => void;
  registerDraft?: DraftExitRegistration<ApiClient>;
};

/** Controllers remain scoped to the current session/project across analysis navigation. */
export default function LiveSettingsWorkspace({ client, projectId, version, registry, newlyCreated, refreshTick,
  setupRefreshTick, diagnosticsRevision, onSaved, onAccessLost, onVersionChange, registerDraft }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('project');
  const tabsRef = useRef<HTMLElement>(null);
  const select = (next: Tab) => { setTab(next); tabsRef.current?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus(); };
  return <div className="settings-workspace">
    <nav className="settings-tabs" role="tablist" aria-label={t('settings:tabsLabel')} ref={tabsRef} onKeyDown={event => {
      const index = TABS.findIndex(item => item.id === tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); select(TABS[next].id);
    }}>
      {TABS.map(item => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab"
        aria-selected={tab === item.id} aria-controls={`settings-panel-${item.panel}`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)}>{t(`settings:${item.label}`)}</button>)}
    </nav>
    {newlyCreated && <section className="project-onboarding" aria-label={t('settings:newProjectLabel')} role="status">
      <h2>{t('settings:newProjectTitle')}</h2><ol className="setup-steps"><li>{t('settings:newProjectStep1')}</li><li aria-current={registry ? undefined : 'step'}>{t('settings:newProjectStep2')}</li><li aria-current={registry ? 'step' : undefined}>{t('settings:newProjectStep3')}</li></ol>
      <p>{t('settings:newProjectHelp')}</p><button type="button" className="text-button" onClick={() => select('schema')}>{t('settings:goToSchema')}</button> · <button type="button" className="text-button" onClick={() => select('sdk')}>{t('settings:goToSdk')}</button>
    </section>}
    {/* Hide panels without unmounting their draft controllers or unresolved writes. */}
    <section id="settings-panel-diagnostics" role="tabpanel" aria-labelledby="settings-tab-diagnostics" hidden={tab !== 'diagnostics'} tabIndex={0}>
    <CollectionDiagnostics client={client} projectId={projectId} version={version} refreshTick={refreshTick + setupRefreshTick + diagnosticsRevision} />
      <LiveHealth client={client} />
      <DeferredPanel label={t('settings:operationsLogReport')}><ObservationReportPanel client={client} /></DeferredPanel>
    </section>
    <section id="settings-panel-editor" role="tabpanel" aria-labelledby={`settings-tab-${tab === 'access' ? 'access' : 'project'}`} hidden={tab !== 'project' && tab !== 'access'} tabIndex={0}>
      <div hidden={tab !== 'access'}><LiveIdentity client={client} /></div>
    <LiveSettings client={client} projectId={projectId} onSaved={onSaved} refreshTick={refreshTick} onAccessLost={onAccessLost} registry={registry} registerDraft={registerDraft} panel={tab === 'access' ? 'access' : 'project'} />
    </section>
    <section id="settings-panel-schema" role="tabpanel" aria-labelledby="settings-tab-schema" hidden={tab !== 'schema'} tabIndex={0}>
    <LiveSchemas client={client} projectId={projectId} refreshTick={refreshTick} onVersionChange={onVersionChange} onAccessLost={onAccessLost} registerDraft={registerDraft} />
    </section>
    <section id="settings-panel-sdk" role="tabpanel" aria-labelledby="settings-tab-sdk" hidden={tab !== 'sdk'} tabIndex={0}>
    <LiveSdkSetup client={client} projectId={projectId} refreshTick={setupRefreshTick + refreshTick} />
    </section>
  </div>;
}
