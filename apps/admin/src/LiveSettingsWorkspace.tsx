import CollectionDiagnostics from './CollectionDiagnostics';
import LiveSettings from './LiveSettings';
import LiveSchemas from './LiveSchemas';
import LiveSdkSetup from './LiveSdkSetup';
import type { ApiClient } from './api/client';
import type { ProjectSettings, Registry } from './api/types';
import type { DraftExitRegistration } from './api/draft-exit-guard';

type Props = {
  client: ApiClient; projectId: string; version: number | null; registry: Registry | null;
  newlyCreated: boolean; refreshTick: number; setupRefreshTick: number; diagnosticsRevision: number;
  onSaved: (settings: ProjectSettings) => void; onAccessLost: () => void; onVersionChange: (version: number) => void;
  registerDraft?: DraftExitRegistration<ApiClient>;
};

/** Controllers remain scoped to the current session/project across analysis navigation. */
export default function LiveSettingsWorkspace({ client, projectId, version, registry, newlyCreated, refreshTick,
  setupRefreshTick, diagnosticsRevision, onSaved, onAccessLost, onVersionChange, registerDraft }: Props) {
  return <>
    {newlyCreated && <section className="project-onboarding" aria-label="새 프로젝트 연결" role="status">
      <h2>프로젝트 생성을 확인했어요</h2><ol className="setup-steps"><li>1 프로젝트 완료</li><li aria-current={registry ? undefined : 'step'}>2 이벤트 스키마</li><li aria-current={registry ? 'step' : undefined}>3 SDK 연결</li></ol>
      <p>먼저 이벤트 스키마를 검증·발행한 뒤 SDK를 연결하세요.</p><a href="#schema-heading">이벤트 스키마로 이동</a> · <a href="#sdk-setup">SDK 연결 안내</a>
    </section>}
    <CollectionDiagnostics client={client} projectId={projectId} version={version} refreshTick={refreshTick + setupRefreshTick + diagnosticsRevision} />
    <LiveSettings client={client} projectId={projectId} onSaved={onSaved} refreshTick={refreshTick} onAccessLost={onAccessLost} registry={registry} registerDraft={registerDraft} />
    <LiveSchemas client={client} projectId={projectId} refreshTick={refreshTick} onVersionChange={onVersionChange} onAccessLost={onAccessLost} registerDraft={registerDraft} />
    <LiveSdkSetup client={client} projectId={projectId} refreshTick={setupRefreshTick + refreshTick} />
  </>;
}
