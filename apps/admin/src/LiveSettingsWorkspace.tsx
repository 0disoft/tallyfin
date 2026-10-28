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
import './settings-workspace.css';

const ObservationReportPanel = lazy(() => import('./ObservationReportPanel'));
const TABS = [
  { id: 'project', label: '프로젝트', panel: 'editor' },
  { id: 'diagnostics', label: '수집 진단', panel: 'diagnostics' },
  { id: 'schema', label: '이벤트 스키마', panel: 'schema' },
  { id: 'sdk', label: 'SDK 연결', panel: 'sdk' },
  { id: 'access', label: '접근 권한', panel: 'editor' },
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
  const [tab, setTab] = useState<Tab>('project');
  const tabsRef = useRef<HTMLElement>(null);
  const select = (next: Tab) => { setTab(next); tabsRef.current?.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus(); };
  return <div className="settings-workspace">
    <nav className="settings-tabs" role="tablist" aria-label="설정 항목" ref={tabsRef} onKeyDown={event => {
      const index = TABS.findIndex(item => item.id === tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); select(TABS[next].id);
    }}>
      {TABS.map(item => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab"
        aria-selected={tab === item.id} aria-controls={`settings-panel-${item.panel}`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>
    {newlyCreated && <section className="project-onboarding" aria-label="새 프로젝트 연결" role="status">
      <h2>프로젝트 생성을 확인했어요</h2><ol className="setup-steps"><li>1 프로젝트 완료</li><li aria-current={registry ? undefined : 'step'}>2 이벤트 스키마</li><li aria-current={registry ? 'step' : undefined}>3 SDK 연결</li></ol>
      <p>먼저 이벤트 스키마를 검증·발행한 뒤 SDK를 연결하세요.</p><button type="button" className="text-button" onClick={() => select('schema')}>이벤트 스키마로 이동</button> · <button type="button" className="text-button" onClick={() => select('sdk')}>SDK 연결 안내</button>
    </section>}
    {/* Hide panels without unmounting their draft controllers or unresolved writes. */}
    <section id="settings-panel-diagnostics" role="tabpanel" aria-labelledby="settings-tab-diagnostics" hidden={tab !== 'diagnostics'} tabIndex={0}>
    <CollectionDiagnostics client={client} projectId={projectId} version={version} refreshTick={refreshTick + setupRefreshTick + diagnosticsRevision} />
      <LiveHealth client={client} />
      <DeferredPanel label="운영 로그 보고서"><ObservationReportPanel client={client} /></DeferredPanel>
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
